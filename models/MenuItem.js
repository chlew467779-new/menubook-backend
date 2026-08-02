const mongoose = require('mongoose');

const menuItemSchema = new mongoose.Schema({
  restaurant_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true },
  page_index: { type: Number, default: 0, min: 0, max: 9 },
  name_zh: { type: String, required: true },
  name_en: { type: String, required: true },
  name_ms: { type: String, required: true },
  desc_zh: { type: String, default: '' },
  desc_en: { type: String, default: '' },
  desc_ms: { type: String, default: '' },
  price: { type: String, required: true },
  image_url: { type: String, default: '' },
  tags_zh: [{ type: String }],
  tags_en: [{ type: String }],
  tags_ms: [{ type: String }],
  display_order: { type: Number, default: 0 },
  is_available: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('MenuItem', menuItemSchema);
