const express = require("express");
const { requireAuth } = require("../middleware/auth");
const settings = require("../utils/settings");

const router = express.Router();

// GET /api/settings - every signed-in user: the screens use them for limits and for which buttons to show
router.get("/settings", requireAuth(), async (req, res) => {
  try {
    res.json(settings.describe(await settings.load()));
  } catch (err) {
    console.error("GET /settings failed:", err.message);
    res.status(500).json({ message: "Could not load the settings." });
  }
});

// PUT /api/admin/settings  { values: { key: value, ... } } - admins; only the keys sent are changed
router.put("/admin/settings", requireAuth(["ADMIN"]), async (req, res) => {
  try {
    const r = await settings.save(req.body?.values, req.user);
    if (r.error) return res.status(400).json({ message: r.error });
    console.log(`Settings changed by ${req.user.name}: ${Object.keys(req.body.values).join(", ")}`);
    res.json(settings.describe(r.doc));
  } catch (err) {
    console.error("PUT /admin/settings failed:", err.message);
    res.status(500).json({ message: "Could not save the settings." });
  }
});

module.exports = router;
