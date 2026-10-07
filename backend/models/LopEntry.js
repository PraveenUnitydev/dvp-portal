const mongoose = require("mongoose");

// One LOP concern entry for one DVP in one program. Entries are only ever ADDED: a newer entry never replaces an
// older one, so the list of entries is the full history. Every field is immutable, and the API has no route that
// edits or deletes an entry. `seq` numbers a DVP's entries 1, 2, 3... in the program.
const lopEntrySchema = new mongoose.Schema({
  program:    { type: mongoose.Schema.Types.ObjectId, ref: "Program", required: true, immutable: true },
  dvp:        { type: mongoose.Schema.Types.ObjectId, ref: "Dvp", required: true, immutable: true },
  seq:        { type: Number, required: true, min: 1, immutable: true },
  details:    { type: String, required: true, maxlength: 4000, immutable: true },
  casVersion: { type: String, default: "", maxlength: 120, immutable: true },
  cadVersion: { type: String, default: "", maxlength: 120, immutable: true },
  images:     { type: [String], default: [], immutable: true },       // file names in the LOP uploads folder
  // Who raised it. Taken from the signed-in user on the server, never from what the browser sends.
  raisedBy: {
    userId:   { type: mongoose.Schema.Types.ObjectId, immutable: true },
    username: { type: String, default: "", immutable: true },
    name:     { type: String, default: "", immutable: true },
    role:     { type: String, default: "", immutable: true },
  },
}, { timestamps: { createdAt: true, updatedAt: false } });

lopEntrySchema.index({ program: 1, dvp: 1, seq: 1 }, { unique: true });

module.exports = mongoose.model("LopEntry", lopEntrySchema);
