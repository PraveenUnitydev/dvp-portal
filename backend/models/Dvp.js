const mongoose = require("mongoose");

// The master DVP catalog - program-independent. Stored without the program
// prefix (UDVP-101-01, not U171-UDVP-101-01): the same test definition is
// reused across programs, and the full number is built per program.
const dvpSchema = new mongoose.Schema({
  code:                { type: String, required: true, unique: true, trim: true },
  type:                { type: String, enum: ["Usability", "Visibility"], required: true },
  component:           { type: String, trim: true, default: "" },
  evaluationParameter: { type: String, trim: true, default: "" },
  fullName:            { type: String, trim: true, default: "" },
  zone: {
    order: { type: Number, required: true },
    name:  { type: String, required: true, trim: true },
  },
  ergonomicsArea:      { type: String, trim: true, default: "" },
  cas:                 { type: String, trim: true, default: "" },
  requirement:         { type: String, default: "" },
  acceptanceCriteria:  { type: String, default: "" },
  procedure:           { type: String, default: "" },
  procedureAvailable:  { type: Boolean, default: false },
  vrCapability:        { type: String, enum: ["Yes", "No", "Partial"], default: "No" },
  // File names under public/dvp-images, in the sheet's column order
  referenceImages:     { type: [String], default: [] },
}, { timestamps: true });

module.exports = mongoose.model("Dvp", dvpSchema);
