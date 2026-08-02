const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
const Restaurant = require('../models/Restaurant');
const MenuItem = require('../models/MenuItem');
const Analytics = require('../models/Analytics');
const auth = require('../middleware/auth');

const router = express.Router();

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'menubook/dishes',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 800, height: 800, crop: 'limit' }],
  },
});

const upload = multer({ storage: storage });

// ================= PUBLIC ROUTES =================

// Get restaurant public data
router.get('/:slug', async (req, res) => {
  try {
    const restaurant = await Restaurant.findOne({ 
      slug: req.params.slug, 
      is_active: true 
    }).select('-password_hash');

    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    // Track view
    const today = new Date().toISOString().split('T')[0];
    await Analytics.findOneAndUpdate(
      { restaurant_id: restaurant._id, date: today },
      { $inc: { views: 1 } },
      { upsert: true, new: true }
    );

    res.json(restaurant);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get menu items for a restaurant
router.get('/:slug/menu', async (req, res) => {
  try {
    const restaurant = await Restaurant.findOne({ slug: req.params.slug });
    if (!restaurant) return res.status(404).json({ error: 'Not found' });

    const items = await MenuItem.find({ 
      restaurant_id: restaurant._id,
      is_available: true 
    }).sort({ page_index: 1, display_order: 1 });

    // Group by page
    const grouped = {};
    items.forEach(item => {
      const page = item.page_index;
      if (!grouped[page]) grouped[page] = [];
      grouped[page].push(item);
    });

    res.json(grouped);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Search menu items
router.get('/:slug/search', async (req, res) => {
  try {
    const { q, lang = 'zh' } = req.query;
    const restaurant = await Restaurant.findOne({ slug: req.params.slug });
    if (!restaurant) return res.status(404).json({ error: 'Not found' });

    const nameField = `name_${lang}`;
    const descField = `desc_${lang}`;
    const tagField = `tags_${lang}`;

    const items = await MenuItem.find({
      restaurant_id: restaurant._id,
      is_available: true,
      $or: [
        { [nameField]: { $regex: q, $options: 'i' } },
        { [descField]: { $regex: q, $options: 'i' } },
        { [tagField]: { $regex: q, $options: 'i' } }
      ]
    });

    // Track search
    const today = new Date().toISOString().split('T')[0];
    await Analytics.findOneAndUpdate(
      { restaurant_id: restaurant._id, date: today },
      { $inc: { search_count: 1 } },
      { upsert: true }
    );

    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Track language switch
router.post('/:slug/track-lang', async (req, res) => {
  try {
    const { lang } = req.body;
    const restaurant = await Restaurant.findOne({ slug: req.params.slug });
    if (!restaurant) return res.status(404).json({ error: 'Not found' });

    const today = new Date().toISOString().split('T')[0];
    const update = { $inc: {} };
    update.$inc[`lang_switches.${lang}`] = 1;

    await Analytics.findOneAndUpdate(
      { restaurant_id: restaurant._id, date: today },
      update,
      { upsert: true }
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================= AUTH ROUTES =================

// Login
router.post('/:slug/login', async (req, res) => {
  try {
    const { password } = req.body;
    const restaurant = await Restaurant.findOne({ slug: req.params.slug });

    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    const isMatch = await bcrypt.compare(password, restaurant.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    const token = jwt.sign(
      { id: restaurant._id, slug: restaurant.slug },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    // Get today's stats
    const today = new Date().toISOString().split('T')[0];
    const stats = await Analytics.findOne({ 
      restaurant_id: restaurant._id, 
      date: today 
    });

    res.json({
      token,
      restaurant: {
        id: restaurant._id,
        name_zh: restaurant.name_zh,
        name_en: restaurant.name_en,
        name_ms: restaurant.name_ms,
      },
      today_views: stats?.views || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================= PROTECTED ROUTES =================

// Get analytics
router.get('/:slug/analytics', auth, async (req, res) => {
  try {
    const { range = '7' } = req.query; // days
    const days = parseInt(range);
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - days);

    const stats = await Analytics.find({
      restaurant_id: req.restaurant._id,
      date: { $gte: startDate.toISOString().split('T')[0] }
    }).sort({ date: 1 });

    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update restaurant info
router.put('/:slug', auth, async (req, res) => {
  try {
    const updates = req.body;
    delete updates.password_hash; // Don't allow password update here
    updates.updated_at = new Date();

    const restaurant = await Restaurant.findOneAndUpdate(
      { slug: req.params.slug },
      { $set: updates },
      { new: true }
    ).select('-password_hash');

    res.json(restaurant);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Change password
router.put('/:slug/password', auth, async (req, res) => {
  try {
    const { newPassword } = req.body;
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(newPassword, salt);

    await Restaurant.findOneAndUpdate(
      { slug: req.params.slug },
      { $set: { password_hash: hash, updated_at: new Date() } }
    );

    res.json({ success: true, message: 'Password updated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload image
router.post('/:slug/upload', auth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }
    res.json({ 
      url: req.file.path,
      public_id: req.file.filename 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all menu items (for admin)
router.get('/:slug/admin/menu', auth, async (req, res) => {
  try {
    const items = await MenuItem.find({ 
      restaurant_id: req.restaurant._id 
    }).sort({ page_index: 1, display_order: 1 });
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create menu item
router.post('/:slug/menu', auth, async (req, res) => {
  try {
    const item = new MenuItem({
      ...req.body,
      restaurant_id: req.restaurant._id
    });
    await item.save();
    res.status(201).json(item);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update menu item
router.put('/:slug/menu/:itemId', auth, async (req, res) => {
  try {
    const item = await MenuItem.findOneAndUpdate(
      { _id: req.params.itemId, restaurant_id: req.restaurant._id },
      { $set: { ...req.body, updated_at: new Date() } },
      { new: true }
    );
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete menu item
router.delete('/:slug/menu/:itemId', auth, async (req, res) => {
  try {
    const item = await MenuItem.findOneAndDelete({
      _id: req.params.itemId,
      restaurant_id: req.restaurant._id
    });
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Toggle item availability
router.patch('/:slug/menu/:itemId/toggle', auth, async (req, res) => {
  try {
    const item = await MenuItem.findOne({
      _id: req.params.itemId,
      restaurant_id: req.restaurant._id
    });
    if (!item) return res.status(404).json({ error: 'Item not found' });

    item.is_available = !item.is_available;
    item.updated_at = new Date();
    await item.save();

    res.json(item);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Seed data endpoint (for initial setup)
router.post('/seed/setup', async (req, res) => {
  try {
    const { password } = req.body;
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    const restaurant = new Restaurant({
      slug: 'demo-restaurant',
      name_zh: '美味轩餐厅',
      name_en: 'Mei Wei Xuan Restaurant',
      name_ms: 'Restoran Mei Wei Xuan',
      tagline_zh: '传承经典 · 品味生活',
      tagline_en: 'Classic Taste · Quality Life',
      tagline_ms: 'Rasa Klasik · Hidup Berkualiti',
      address: 'Jalan SS15/4G, Subang Jaya, Selangor',
      phone: '+60 12-345 6789',
      email: 'hello@meiweixuan.my',
      hours: '10:00 AM - 10:00 PM',
      password_hash: hash,
      theme: 'paper',
      items_per_page: 6,
      img_size: 'medium',
      map_lat: 3.0738,
      map_lng: 101.5183
    });

    await restaurant.save();

    // Seed sample menu items
    const sampleItems = [
      { page_index: 0, name_zh: '椰浆饭 Nasi Lemak', name_en: 'Nasi Lemak', name_ms: 'Nasi Lemak', desc_zh: '香米、椰浆、叁巴酱、黄瓜、花生、江鱼仔、水煮蛋', desc_en: 'Fragrant rice, coconut milk, sambal, cucumber, peanuts, anchovies, boiled egg', desc_ms: 'Nasi wangi, santan, sambal, timun, kacang, ikan bilis, telur rebus', price: 'RM 8.50', image_url: 'https://images.unsplash.com/photo-1569058242253-92a9c755a0ec?w=400', tags_zh: ['马来西亚','辣'], tags_en: ['Malaysian','Spicy'], tags_ms: ['Malaysia','Pedas'], display_order: 0 },
      { page_index: 0, name_zh: '海南鸡饭', name_en: 'Hainanese Chicken Rice', name_ms: 'Nasi Ayam Hainan', desc_zh: '嫩滑白切鸡、香油饭、姜蓉、辣椒酱', desc_en: 'Tender poached chicken, fragrant rice, ginger paste, chili sauce', desc_ms: 'Ayam rebus lembut, nasi wangi, halia, cili', price: 'RM 12.00', image_url: 'https://images.unsplash.com/photo-1603133872878-684f208fb84b?w=400', tags_zh: ['中餐','招牌'], tags_en: ['Chinese','Signature'], tags_ms: ['Cina','Tandatangan'], display_order: 1 },
      { page_index: 0, name_zh: 'Margherita Pizza', name_en: 'Margherita Pizza', name_ms: 'Pizza Margherita', desc_zh: '新鲜番茄、马苏里拉芝士、罗勒叶、橄榄油', desc_en: 'Fresh tomato, mozzarella, basil, olive oil', desc_ms: 'Tomat segar, mozzarella, daun basil, minyak zaitun', price: 'RM 28.00', image_url: 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=400', tags_zh: ['西餐','素食'], tags_en: ['Western','Vegetarian'], tags_ms: ['Barat','Sayur'], display_order: 2 },
      { page_index: 0, name_zh: '咖啡冰 Kopi Peng', name_en: 'Iced Coffee (Kopi Peng)', name_ms: 'Kopi Peng', desc_zh: '传统海南咖啡、炼奶、冰块', desc_en: 'Traditional Hainan coffee, condensed milk, ice', desc_ms: 'Kopi Hainan tradisional, susu pekat, ais', price: 'RM 3.50', image_url: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=400', tags_zh: ['饮料','复古'], tags_en: ['Drink','Classic'], tags_ms: ['Minuman','Klasik'], display_order: 3 },
      { page_index: 0, name_zh: '提拉米苏', name_en: 'Tiramisu', name_ms: 'Tiramisu', desc_zh: '马斯卡彭芝士、浓缩咖啡、可可粉、手指饼干', desc_en: 'Mascarpone, espresso, cocoa powder, ladyfingers', desc_ms: 'Mascarpone, espresso, serbuk koko, biskut ladyfinger', price: 'RM 15.00', image_url: 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=400', tags_zh: ['甜点','西式'], tags_en: ['Dessert','Western'], tags_ms: ['Pencuci Mulut','Barat'], display_order: 4 },
      { page_index: 0, name_zh: '叉烧云吞面', name_en: 'Char Siew Wantan Mee', name_ms: 'Wantan Mee Char Siew', desc_zh: '自制叉烧、鲜虾云吞、弹牙面条', desc_en: 'Homemade BBQ pork, fresh shrimp wantan, springy noodles', desc_ms: 'Char siew buatan sendiri, wantan udang segar, mi kenyal', price: 'RM 10.00', image_url: 'https://images.unsplash.com/photo-1552611052-33e04de081de?w=400', tags_zh: ['中餐','面食'], tags_en: ['Chinese','Noodles'], tags_ms: ['Cina','Mi'], display_order: 5 },

      { page_index: 1, name_zh: '黑胡椒牛排', name_en: 'Black Pepper Steak', name_ms: 'Steak Lada Hitam', desc_zh: '200g澳洲牛排、黑胡椒酱、烤蔬菜、薯条', desc_en: '200g Australian beef, pepper sauce, roasted vegetables, fries', desc_ms: 'Daging lembu Australia 200g, sos lada hitam, sayur panggang, kentang goreng', price: 'RM 45.00', image_url: 'https://images.unsplash.com/photo-1600891964092-4316c288032e?w=400', tags_zh: ['西餐','牛肉'], tags_en: ['Western','Beef'], tags_ms: ['Barat','Lembu'], display_order: 0 },
      { page_index: 1, name_zh: 'Seafood Pasta', name_en: 'Seafood Pasta', name_ms: 'Pasta Makanan Laut', desc_zh: '大虾、青口、鱿鱼、蒜香橄榄油意面', desc_en: 'Prawns, mussels, squid, garlic olive oil pasta', desc_ms: 'Udang, kerang, sotong, pasta minyak zaitun bawang putih', price: 'RM 32.00', image_url: 'https://images.unsplash.com/photo-1563379926898-05f4575a45d8?w=400', tags_zh: ['西餐','海鲜'], tags_en: ['Western','Seafood'], tags_ms: ['Barat','Makanan Laut'], display_order: 1 },
      { page_index: 1, name_zh: '咖喱鱼头', name_en: 'Curry Fish Head', name_ms: 'Kepala Ikan Kari', desc_zh: '新鲜鱼头、咖喱酱、秋葵、茄子、豆腐卜', desc_en: 'Fresh fish head, curry sauce, okra, eggplant, tofu puffs', desc_ms: 'Kepala ikan segar, sos kari, bendi, terung, tauhu pok', price: 'RM 38.00', image_url: 'https://images.unsplash.com/photo-1455619452474-d2be8b1e70cd?w=400', tags_zh: ['马来西亚','辣'], tags_en: ['Malaysian','Spicy'], tags_ms: ['Malaysia','Pedas'], display_order: 2 },

      { page_index: 2, name_zh: '芒果糯米饭', name_en: 'Mango Sticky Rice', name_ms: 'Pulut Mangga', desc_zh: '泰国香糯米、新鲜芒果、椰浆', desc_en: 'Thai glutinous rice, fresh mango, coconut milk', desc_ms: 'Pulut Thai, mangga segar, santan', price: 'RM 12.00', image_url: 'https://images.unsplash.com/photo-1596797038530-2c107229654b?w=400', tags_zh: ['甜点','泰式'], tags_en: ['Dessert','Thai'], tags_ms: ['Pencuci Mulut','Thai'], display_order: 0 },
      { page_index: 2, name_zh: '巧克力熔岩蛋糕', name_en: 'Chocolate Lava Cake', name_ms: 'Kek Coklat Lava', desc_zh: '70%黑巧克力、香草冰淇淋', desc_en: '70% dark chocolate, vanilla ice cream', desc_ms: 'Coklat hitam 70%, aiskrim vanila', price: 'RM 18.00', image_url: 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?w=400', tags_zh: ['甜点','西式'], tags_en: ['Dessert','Western'], tags_ms: ['Pencuci Mulut','Barat'], display_order: 1 },
      { page_index: 2, name_zh: 'Cendol 煎蕊', name_en: 'Cendol', name_ms: 'Cendol', desc_zh: '椰糖、红豆、绿豆粉条、椰奶、刨冰', desc_en: 'Palm sugar, red beans, green jelly, coconut milk, shaved ice', desc_ms: 'Gula melaka, kacang merah, cendol, santan, ais kacang', price: 'RM 6.50', image_url: 'https://images.unsplash.com/photo-1563805042-7684c019e1cb?w=400', tags_zh: ['甜点','马来西亚'], tags_en: ['Dessert','Malaysian'], tags_ms: ['Pencuci Mulut','Malaysia'], display_order: 2 },
    ];

    for (const item of sampleItems) {
      await new MenuItem({ ...item, restaurant_id: restaurant._id }).save();
    }

    res.json({ 
      success: true, 
      message: 'Demo restaurant created',
      restaurant: { id: restaurant._id, slug: restaurant.slug }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
