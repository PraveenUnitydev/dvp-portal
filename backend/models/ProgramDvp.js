const mongoose = require("mongoose");

// Which catalog DVPs apply to which program, plus that program's own
// progress on each one. A DVP with no row here for a program is simply
// not part of that program and is never shown for it.
const programDvpSchema = new mongoose.Schema({
  program:         { type: mongoose.Schema.Types.ObjectId, ref: "Program", required: true },
  dvp:             { type: mongoose.Schema.Types.ObjectId, ref: "Dvp", required: true },
  responsibility:  { type: String, trim: true, default: "" },
  completedStatus: { type: String, enum: ["Done", "Not done"], default: "Not done" },
  result:          { type: String, enum: ["Green", "Red", "Pending"], default: "Pending" },
  reason:          { type: String, trim: true, default: "" },
  remarks:         { type: String, default: "" },
}, { timestamps: true });

programDvpSchema.index({ program: 1, dvp: 1 }, { unique: true });

module.exports = mongoose.model("ProgramDvp", programDvpSchema);
