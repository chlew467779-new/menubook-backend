const mongoose = require('mongoose');

const analyticsSchema = new mongoose.Schema({
  restaurant_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true },
  date: { type: String, required: true }, // YYYY-MM-DD
  views: { type: Number, default: 0 },
  unique_visitors: { type: Number, default: 0 },
  search_count: { type: Number, default: 0 },
  lang_switches: {
    zh: { type: Number, default: 0 },
    en: { type: Number, default: 0 },
    ms: { type: Number, default: 0 }
  }
});

analyticsSchema.index({ restaurant_id: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('Analytics', analyticsSchema);
