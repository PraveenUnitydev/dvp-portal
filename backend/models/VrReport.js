const mongoose = require("mongoose");

// A VR assessment report made outside the portal (PDF / PowerPoint / Word / Excel), uploaded by an admin for one
// program. A program can have several (one per assessment round, say); the newest is the one "Download VR report"
// gives. The file itself lives in the uploads folder (see config.js), named <_id>.<ext>.
const vrReportSchema = new mongoose.Schema({
  program:      { type: mongoose.Schema.Types.ObjectId, ref: "Program", required: true, index: true },
  title:        { type: String, required: true, trim: true, maxlength: 120 },
  notes:        { type: String, default: "", trim: true, maxlength: 500 },
  file:         { type: String, required: true },            // stored file name
  ext:          { type: String, required: true, enum: ["pdf", "pptx", "docx", "xlsx"] },
  originalName: { type: String, default: "" },                // as uploaded, cleaned; used for the download name
  size:         { type: Number, required: true },
  uploadedBy: {
    userId:   { type: mongoose.Schema.Types.ObjectId },
    username: { type: String, default: "" },
    name:     { type: String, default: "" },
  },
}, { timestamps: { createdAt: true, updatedAt: false } });

module.exports = mongoose.model("VrReport", vrReportSchema);
