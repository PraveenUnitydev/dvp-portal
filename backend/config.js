const path = require("path");

// Where DVP reference images live. Sheet images ship with the app; images uploaded in
// the portal go to a separate folder so deploying (git pull) never touches them.
// Set UPLOAD_DIR in .env to keep uploads somewhere that survives redeploys.
const UPLOAD_DIR = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(__dirname, "uploads");

module.exports = {
  SHEET_IMAGE_DIR: path.join(__dirname, "public", "dvp-images"),
  UPLOAD_IMAGE_DIR: path.join(UPLOAD_DIR, "dvp-images"),
  // Pictures attached to LOP concerns. Unlike reference images these are served only to signed-in users.
  UPLOAD_LOP_DIR: path.join(UPLOAD_DIR, "lop-images"),
};
