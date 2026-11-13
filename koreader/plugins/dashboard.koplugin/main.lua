--[[--
ROBN4 Dashboard — displays a server-rendered e-ink dashboard PNG.

The device does no data work: the renderer produces a 1072x1448 grayscale PNG
plus a ~200 byte JSON manifest. This plugin fetches the manifest first (cheap),
only downloads the image when `rendered_at` has moved, and keeps wifi up for the
shortest possible time.

Honesty rule: the PNG carries a clock from the moment it was RENDERED, which may
be well in the past. Whenever the image is older than `stale_after`, a badge is
drawn over the footer saying so, so a stale dashboard can never pass as current.
]]

local Blitbuffer = require("ffi/blitbuffer")
local BottomContainer = require("ui/widget/container/bottomcontainer")
local DataStorage = require("datastorage")
local Device = require("device")
local Dispatcher = require("dispatcher")
local Font = require("ui/font")
local FrameContainer = require("ui/widget/container/framecontainer")
local Geom = require("ui/geometry")
local GestureRange = require("ui/gesturerange")
local ImageWidget = require("ui/widget/imagewidget")
local InfoMessage = require("ui/widget/infomessage")
local InputContainer = require("ui/widget/container/inputcontainer")
local InputDialog = require("ui/widget/inputdialog")
local LuaSettings = require("luasettings")
local NetworkMgr = require("ui/network/manager")
local OverlapGroup = require("ui/widget/overlapgroup")
local RightContainer = require("ui/widget/container/rightcontainer")
local Size = require("ui/size")
local TextWidget = require("ui/widget/textwidget")
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local _ = require("gettext")
local Screen = Device.screen

-- networking (all bundled with KOReader)
local socket = require("socket")
local socket_url = require("socket.url")
local socketutil = require("socketutil")
local http = require("socket.http")
local https = require("ssl.https")
local ltn12 = require("ltn12")

local DEFAULTS = {
    -- Published by .github/workflows/render.yml every 15 minutes.
    -- A saved setting overrides this, so an existing install keeps its own URL.
    base_url     = "https://chenrisius.github.io/robn4-kindle-dashboard",
    min_interval = 600,    -- never hit the network more often than this (s)
    stale_after  = 1800,   -- draw the staleness badge past this age (s)
}

-- ---------------------------------------------------------------- helpers --

local function decodeJson(str)
    if type(str) ~= "string" or str == "" then return nil end
    -- rapidjson ships with current KOReader; dkjson is the older fallback
    for _, mod in ipairs({ "rapidjson", "json" }) do
        local got, lib = pcall(require, mod)
        if got and lib and lib.decode then
            local ok, obj = pcall(lib.decode, str)
            if ok and type(obj) == "table" then return obj end
        end
    end
    return nil
end

--- GET `url` into `sink`. Returns true, or nil plus a message.
local function httpGet(url, sink)
    local parsed = socket_url.parse(url)
    if not parsed or not parsed.scheme then return nil, "bad URL" end
    local requester = (parsed.scheme == "https") and https or http

    socketutil:set_timeout(10, 40)
    -- request{} must be INSIDE the closure or pcall can't catch its errors
    local ok, code = pcall(function()
        return socket.skip(1, requester.request{
            url = url,
            method = "GET",
            sink = sink,
            headers = { ["User-Agent"] = "KOReader-dashboard/1.0" },
        })
    end)
    socketutil:reset_timeout()

    if not ok then return nil, tostring(code) end
    if code == nil then return nil, "no response" end
    if code ~= 200 then return nil, "HTTP " .. tostring(code) end
    return true
end

local function joinUrl(base, name)
    if base:sub(-1) == "/" then return base .. name end
    return base .. "/" .. name
end

local function fileExists(path)
    return path ~= nil and lfs.attributes(path, "mode") == "file"
end

local function humanAge(seconds)
    if seconds < 90 then return "just now" end
    local m = math.floor(seconds / 60)
    if m < 60 then return string.format("%dm", m) end
    return string.format("%dh %02dm", math.floor(m / 60), m % 60)
end

-- ------------------------------------------------------------ the display --

local DashboardView = InputContainer:extend{
    image_path = nil,
    image_w = nil,     -- from the manifest, so we can pick the scaling mode
    image_h = nil,
    badge_text = nil,
    on_refresh = nil,
    on_closed = nil,   -- lets the plugin forget a view the user dismissed
}

function DashboardView:init()
    self.dimen = Geom:new{ x = 0, y = 0, w = Screen:getWidth(), h = Screen:getHeight() }
    self.covers_fullscreen = true

    if Device:isTouchDevice() then
        self.ges_events = {
            Tap = { GestureRange:new{ ges = "tap", range = self.dimen } },
        }
    end
    if Device:hasKeys() then
        self.key_events = {
            Close = { { Device.input.group.Back } },
        }
    end
    self[1] = self:build()
end

function DashboardView:build()
    -- scale_factor = 1 keeps the native bitmap untouched — no resampling, which
    -- is what preserves 300ppi hairlines and the hatch patterns. Passing only
    -- width/height (scale_factor nil) would instead STRETCH to those dimensions
    -- ignoring aspect ratio, going through a resample path even at 1:1.
    -- The manifest tells us the render's size, so we can check before decoding
    -- and fall back to best-fit (0) only if it isn't the panel's exact size.
    local exact = (self.image_w == self.dimen.w and self.image_h == self.dimen.h)
    local image = ImageWidget:new{
        file = self.image_path,
        width = self.dimen.w,
        height = self.dimen.h,
        scale_factor = exact and 1 or 0,
        -- MUST stay false. ImageCache keys on
        --   "image|<path>|<width>|<height>|<alpha>"
        -- (imagewidget.lua:147) with no mtime, size or content hash. Because
        -- scale_factor is always non-nil here, width/height go into that key as
        -- nil, and our cache path never changes -- so the key is byte-identical
        -- on every refresh. With caching on, the second and later refreshes in
        -- one KOReader session re-display the FIRST decode: fetch() downloads
        -- the new PNG, os.rename swaps it in, and the panel still shows the old
        -- numbers. Worse, the staleness badge is computed from the manifest,
        -- which DID update, so the stale image renders with no badge at all --
        -- the dashboard lying about its age, which is the one failure this
        -- whole design exists to prevent.
        -- Caching is pointless here anyway: a 1072x1448 one-shot bitmap is
        -- ~1.5 MB of the shared cache budget, evicting icons to store something
        -- that is replaced every 15 minutes. false also sets _bb_disposable,
        -- so the buffer is freed when the view closes.
        file_do_cache = false,
    }

    if not self.badge_text then
        return OverlapGroup:new{ dimen = self.dimen:copy(), image }
    end

    -- Badge sits over the footer: when the image is stale, provenance text is
    -- the least costly thing on the page to cover.
    local badge = FrameContainer:new{
        background = Blitbuffer.COLOR_WHITE,
        bordersize = Size.border.thick,
        margin = 0,
        padding = Size.padding.small,
        TextWidget:new{
            text = self.badge_text,
            face = Font:getFace("cfont", 20),
        },
    }
    return OverlapGroup:new{
        dimen = self.dimen:copy(),
        image,
        BottomContainer:new{
            dimen = self.dimen:copy(),
            RightContainer:new{
                dimen = Geom:new{ w = self.dimen.w, h = badge:getSize().h },
                badge,
            },
        },
    }
end

function DashboardView:onShow()
    -- Always a full refresh: partial updates leave ghosting across a page this
    -- dense, and the dashboard changes everywhere at once anyway.
    UIManager:setDirty(self, function() return "full", self.dimen end)
    return true
end

function DashboardView:onCloseWidget()
    if self.on_closed then self.on_closed() end
    UIManager:setDirty(nil, function() return "full", self.dimen end)
end

function DashboardView:onTap(_, ges)
    -- left third refreshes, anything else closes
    if ges and ges.pos and ges.pos.x < self.dimen.w / 3 then
        if self.on_refresh then self.on_refresh() end
    else
        UIManager:close(self)
    end
    return true
end

function DashboardView:onClose()
    UIManager:close(self)
    return true
end

-- ------------------------------------------------------------- the plugin --

local Dashboard = WidgetContainer:extend{
    name = "dashboard",
    is_doc_only = false,
}

function Dashboard:init()
    self.settings = LuaSettings:open(DataStorage:getSettingsDir() .. "/dashboard.lua")
    self.cache_dir = DataStorage:getDataDir() .. "/cache/dashboard"
    if lfs.attributes(self.cache_dir, "mode") ~= "directory" then
        lfs.mkdir(DataStorage:getDataDir() .. "/cache")
        lfs.mkdir(self.cache_dir)
    end
    self.image_path = self.cache_dir .. "/dashboard.png"
    self:onDispatcherRegisterActions()
    self.ui.menu:registerToMainMenu(self)
end

function Dashboard:get(key)
    local v = self.settings:readSetting(key)
    if v == nil then return DEFAULTS[key] end
    return v
end

function Dashboard:onDispatcherRegisterActions()
    Dispatcher:registerAction("dashboard_show", {
        category = "none", event = "ShowDashboard",
        title = _("Show dashboard"), general = true,
    })
end

function Dashboard:onShowDashboard()
    self:show()
    return true
end

function Dashboard:addToMainMenu(menu_items)
    menu_items.dashboard = {
        text = _("ROBN4 Dashboard"),
        sorting_hint = "tools",
        sub_item_table = {
            {
                text = _("Show dashboard"),
                keep_menu_open = false,
                callback = function() self:show() end,
            },
            {
                text = _("Refresh now"),
                keep_menu_open = false,
                callback = function() self:show(true) end,
            },
            {
                text = _("Set dashboard URL"),
                keep_menu_open = true,
                callback = function(touchmenu_instance) self:editUrl(touchmenu_instance) end,
            },
        },
    }
end

function Dashboard:editUrl(touchmenu_instance)
    local dialog
    dialog = InputDialog:new{
        title = _("Dashboard base URL"),
        input = self:get("base_url"),
        input_hint = "https://example.com/dash",
        description = _("Folder containing dashboard.json and dashboard.png."),
        buttons = {{
            { text = _("Cancel"), id = "close",
              callback = function() UIManager:close(dialog) end },
            { text = _("Save"), is_enter_default = true,
              callback = function()
                  local v = dialog:getInputText()
                  self.settings:saveSetting("base_url", v)
                  self.settings:flush()
                  UIManager:close(dialog)
                  if touchmenu_instance then touchmenu_instance:updateItems() end
              end },
        }},
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

--- Read the cached manifest, if any.
function Dashboard:cachedManifest()
    return self.settings:readSetting("last_manifest")
end

--- Pull manifest, then the image only if it actually changed.
--  Returns true when a NEW image landed on disk.
function Dashboard:fetch()
    local base = self:get("base_url")
    if base == nil or base == "" then
        return false, _("No dashboard URL set yet.")
    end

    local body = {}
    local ok, err = httpGet(joinUrl(base, "dashboard.json"), ltn12.sink.table(body))
    if not ok then
        logger.warn("dashboard: manifest fetch failed:", err)
        return false, err
    end

    local manifest = decodeJson(table.concat(body))
    if not manifest or not manifest.rendered_at then
        logger.warn("dashboard: manifest did not parse")
        return false, _("Manifest was not valid JSON.")
    end

    local cached = self:cachedManifest()
    if cached and cached.rendered_at == manifest.rendered_at and fileExists(self.image_path) then
        -- nothing new upstream: skip the image download entirely
        logger.dbg("dashboard: unchanged, skipping image download")
        self.settings:saveSetting("last_checked", os.time())
        self.settings:flush()
        return false, nil, manifest
    end
    logger.info("dashboard: new render", manifest.rendered_iso or manifest.rendered_at,
                "-", manifest.summary or "")

    -- Download to a temp path and only swap on success, so a failed or truncated
    -- transfer can never replace a good cached image.
    local tmp = self.image_path .. ".part"
    local fh = io.open(tmp, "wb")
    if not fh then return false, _("Could not open the cache file for writing.") end

    local ok2, err2 = httpGet(joinUrl(base, manifest.image or "dashboard.png"), ltn12.sink.file(fh))
    if not ok2 then
        os.remove(tmp)
        return false, err2
    end
    local size = lfs.attributes(tmp, "size")
    if not size or size < 1024 then
        os.remove(tmp)
        return false, _("Downloaded image was too small to be real.")
    end

    -- Rename first: on POSIX that atomically replaces the old image. Only fall
    -- back to remove-then-rename if that fails, so a rename error can't leave
    -- us with no cached image at all.
    local renamed = os.rename(tmp, self.image_path)
    if not renamed then
        os.remove(self.image_path)
        renamed = os.rename(tmp, self.image_path)
        if not renamed then
            os.remove(tmp)
            return false, _("Could not replace the cached image.")
        end
    end

    logger.info("dashboard: image cached,", size, "bytes")
    self.settings:saveSetting("last_manifest", manifest)
    self.settings:saveSetting("last_checked", os.time())
    self.settings:flush()
    return true, nil, manifest
end

function Dashboard:staleBadge()
    local m = self:cachedManifest()
    if not m or not m.rendered_at then return nil end
    local age = os.time() - m.rendered_at
    if age < self:get("stale_after") then return nil end
    -- literal UTF-8 em dash rather than a \u{} escape: that escape is a LuaJIT
    -- extension and would fail under plain Lua 5.1
    return string.format("STALE — %s old", humanAge(age))
end

function Dashboard:render()
    if not fileExists(self.image_path) then return end
    if self.view then
        UIManager:close(self.view)
        self.view = nil
    end
    local m = self:cachedManifest() or {}
    self.view = DashboardView:new{
        image_path = self.image_path,
        image_w = m.width,
        image_h = m.height,
        badge_text = self:staleBadge(),
        on_refresh = function() self:show(true) end,
        on_closed = function() self.view = nil end,
    }
    UIManager:show(self.view)
end

--- Show the dashboard. Cached image goes up immediately; the network is only
--  touched if the cache is older than `min_interval`, or `force` is set.
function Dashboard:show(force)
    local had_cache = fileExists(self.image_path)
    -- Only paint if nothing is on screen yet. Re-rendering an already-visible
    -- view costs a second full e-ink refresh for no visual change, which is the
    -- difference between a snappy refresh tap and two seconds of flashing.
    if had_cache and not self.view then self:render() end

    local last = self.settings:readSetting("last_checked") or 0
    local fresh_enough = (os.time() - last) < self:get("min_interval")
    if had_cache and fresh_enough and not force then
        return
    end

    if not had_cache and (self:get("base_url") or "") == "" then
        UIManager:show(InfoMessage:new{
            text = _("Set the dashboard URL first:\nTools > ROBN4 Dashboard > Set dashboard URL"),
        })
        return
    end

    -- runWhenOnline does NOT call back if the connection attempt fails -- its
    -- own docs say so: "it will just attempt to re-connect, *without* running
    -- the callback". Left alone, a refresh tap with no wifi is answered by
    -- total silence. This flag plus a deadline turns that into a message.
    local started = false
    NetworkMgr:runWhenOnline(function()
        started = true
        local updated, err = self:fetch()
        -- Wifi is the dominant battery cost here, so it goes down the moment
        -- the transfer resolves - success or failure.
        if NetworkMgr:isWifiOn() and NetworkMgr.turnOffWifi then
            NetworkMgr:turnOffWifi()
        end

        if updated then
            self:render()   -- the image genuinely changed, so the refresh earns itself
        elseif err then
            if had_cache then
                -- Keep the cached image on screen and just say why it is old.
                -- No re-render: the pixels are identical, so repainting would
                -- only cost another full refresh.
                UIManager:show(InfoMessage:new{
                    text = string.format("%s\n%s", _("Could not refresh:"), tostring(err)),
                    timeout = 4,
                })
            else
                UIManager:show(InfoMessage:new{
                    text = string.format("%s\n%s", _("Could not load dashboard:"), tostring(err)),
                })
            end
        elseif not had_cache then
            self:render()
        end
    end)

    -- Fires only if the callback above never even began, i.e. we never got
    -- online. `started` is set on entry, so a merely slow fetch won't trip it.
    UIManager:scheduleIn(25, function()
        if not started then
            logger.warn("dashboard: never got online; refresh abandoned")
            UIManager:show(InfoMessage:new{
                text = _("Could not get online to refresh.\nShowing the last image."),
                timeout = 5,
            })
        end
    end)
end

return Dashboard
