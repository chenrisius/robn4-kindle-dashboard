local _ = require("gettext")
-- No `name` field: PluginLoader deprecated it (the directory name is used
-- instead) and warns about it on every startup. The `name` in main.lua's
-- WidgetContainer:extend{} is a different thing and is still required.
return {
    fullname = _("ROBN4 Dashboard"),
    description = _([[Fetches a pre-rendered e-ink dashboard PNG and displays it full screen, with a staleness badge when the image is old.]]),
}
