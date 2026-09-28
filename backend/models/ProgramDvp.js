const mongoose = require("mongoose");

// One row per (program, catalog DVP) that an admin has ever switched on.
// `applicable: false` hides the DVP for that program without deleting it,
// so its status, colour and remarks come back if it's switched on again.
const programDvpSchema = new mongoose.Schema({
  program:         { type: mongoose.Schema.Types.ObjectId, ref: "Program", required: true },
  dvp:             { type: mongoose.Schema.Types.ObjectId, ref: "Dvp", required: true },
  applicable:      { type: Boolean, default: true },
  responsibility:  { type: String, trim: true, default: "" },
  completedStatus: { type: String, enum: ["Done", "Not done"], default: "Not done" },
  color:           { type: String, enum: ["Red", "Blue", "Green", null], default: null },
  reason:          { type: String, trim: true, default: "" },
  remarks:         { type: String, default: "", maxlength: 2000 },
  updatedBy:       { type: String, default: "" },
}, { timestamps: true });

programDvpSchema.index({ program: 1, dvp: 1 }, { unique: true });

module.exports = mongoose.model("ProgramDvp", programDvpSchema);
