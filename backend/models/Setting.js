const mongoose = require("mongoose");

// Portal settings an admin can change on the Settings page. One document (key "app") holds the values that differ
// from the defaults in utils/settings.js; a value that isn't stored uses its default.
const settingSchema = new mongoose.Schema({
  key:       { type: String, required: true, unique: true },
  values:    { type: mongoose.Schema.Types.Mixed, default: {} },
  updatedBy: { type: String, default: "" },
}, { timestamps: true, minimize: false });

module.exports = mongoose.model("Setting", settingSchema);
