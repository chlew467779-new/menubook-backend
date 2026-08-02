const mongoose = require('mongoose');

const restaurantSchema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true, lowercase: true },
  name_zh: { type: String, required: true },
  name_en: { type: String, required: true },
  name_ms: { type: String, required: true },
  tagline_zh: { type: String, default: '' },
  tagline_en: { type: String, default: '' },
  tagline_ms: { type: String, default: '' },
  address: { type: String, required: true },
  phone: { type: String, required: true },
  email: { type: String, default: '' },
  hours: { type: String, default: '10:00 AM - 10:00 PM' },
  password_hash: { type: String, required: true },
  bg_image: { type: String, default: '' },
  theme: { type: String, default: 'paper', enum: ['paper', 'dark', 'modern', 'chalk'] },
  items_per_page: { type: Number, default: 6 },
  img_size: { type: String, default: 'medium', enum: ['small', 'medium', 'large'] },
  map_lat: { type: Number, default: 3.0738 },
  map_lng: { type: Number, default: 101.5183 },
  is_active: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Restaurant', restaurantSchema);
