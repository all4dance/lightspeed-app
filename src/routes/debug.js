router.get('/shops/:accountId', async (req, res) => {
  const { accountId } = req.params;

  try {
    // Optional: ?limit=50 if you have many shops, but usually few
    const data = await apiRequest(accountId, 'Shop.json?limit=100');
    res.json(data.Shop || data); // Lightspeed often wraps in { Shop: [...] } or direct array
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});