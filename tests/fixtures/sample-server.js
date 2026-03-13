/**
 * Sample Express server for testing the Express adapter.
 * This is an illustrative rent comps API — NOT a real server, just parsed for testing.
 */

const express = require('express');
const app = express();

app.use(express.json());

// List all properties
app.get('/api/properties', async (req, res) => {
  const { type, limit } = req.query;
  const rows = []; // db query placeholder
  res.json(rows);
});

// Get a single property
app.get('/api/properties/:id', async (req, res) => {
  const { id } = req.params;
  const rows = []; // db query placeholder
  if (!rows[0]) return res.status(404).json({ error: 'Property not found' });
  res.json(rows[0]);
});

// Create a property
app.post('/api/properties', async (req, res) => {
  const { name, address, units, year_built, property_class } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  res.status(201).json({ id: 1, message: 'Property created successfully' });
});

// Update a property
app.put('/api/properties/:id', async (req, res) => {
  const { name, address, units, year_built, property_class } = req.body;
  res.json({ message: 'Property updated successfully' });
});

// Delete a property
app.delete('/api/properties/:id', async (req, res) => {
  const { id } = req.params;
  res.json({ message: 'Property deleted successfully' });
});

// List comps for a property
app.get('/api/properties/:propertyId/comps', async (req, res) => {
  const { propertyId } = req.params;
  const rows = []; // db query placeholder
  res.json(rows);
});

// Add a comp record
app.post('/api/properties/:propertyId/comps', async (req, res) => {
  const { comp_name, rent, beds, baths, sq_ft } = req.body;
  res.status(201).json({ id: 1, message: 'Comp added' });
});

// Get market statistics
app.get('/api/stats/market', async (req, res) => {
  res.json({ avg_rent: 0, vacancy_rate: 0 });
});

// Bulk import rent data
app.post('/api/rent-data/bulk-import', async (req, res) => {
  const { data } = req.body;
  res.json({ message: 'Import complete', imported: 0 });
});

app.listen(process.env.PORT || 3000);
