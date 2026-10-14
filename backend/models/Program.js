const mongoose = require("mongoose");

// A vehicle program (e.g. U171, S302). Which DVPs apply to it lives in
// ProgramDvp, so each program can have its own subset of the catalog.
const programSchema = new mongoose.Schema({
  code:        { type: String, required: true, unique: true, uppercase: true, trim: true },
  name:        { type: String, trim: true, default: "" },
  description: { type: String, trim: true, default: "" },
  active:      { type: Boolean, default: true },
  createdBy:   { type: String, default: "" },
}, { timestamps: true });

module.exports = mongoose.model("Program", programSchema);
