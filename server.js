const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'https://react-odoo-demo.vercel.app'],
  credentials: true
}));
app.use(express.json());

// Config
const ODOO_URL = process.env.ODOO_URL || 'http://10.122.135.14:8069';
const DB = process.env.ODOO_DATABASE || 'dbbrazen';
const USERNAME = process.env.ODOO_USERNAME || 'admin';
const PASSWORD = process.env.ODOO_PASSWORD || 'admin';

console.log('🚀 Backend Proxy Starting');
console.log('Odoo URL:', ODOO_URL);
console.log('Database:', DB);
console.log('Node Environment:', process.env.NODE_ENV || 'development');

// Create axios instance with cookie jar for session management
const cookieJar = new CookieJar();
const odooClient = wrapper(axios.create({
  jar: cookieJar,
  withCredentials: true,
  timeout: 10000,
}));

let sessionId = null;

// ============ Routes ============

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'running',
    message: 'Odoo API Proxy Server',
    endpoints: {
      health: '/health',
      authenticate: 'POST /api/authenticate',
      create_contact: 'POST /api/create-contact',
      fetch_contacts: 'GET /api/contacts'
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'running',
    odoo_url: ODOO_URL,
    timestamp: new Date().toISOString()
  });
});

// Authenticate with Odoo
app.post('/api/authenticate', async (req, res) => {
  try {
    console.log('📝 Authenticating...');
    
    const response = await odooClient.post(`${ODOO_URL}/web/session/authenticate`, {
      jsonrpc: '2.0',
      method: 'call',
      params: {
        db: DB,
        login: USERNAME,
        password: PASSWORD,
      },
    });

    console.log('✓ Auth successful');
    
    if (response.data.result?.uid) {
      sessionId = response.data.result.uid;
      console.log('  Session ID:', sessionId);
    }
    
    res.json(response.data);
  } catch (error) {
    console.error('❌ Auth error:', error.message);
    res.status(500).json({ 
      error: 'Authentication failed',
      message: error.message 
    });
  }
});

// Create contact
app.post('/api/create-contact', async (req, res) => {
  try {
    const { name, phone } = req.body;
    console.log('📝 Creating contact:', { name, phone });

    // Validate input
    if (!name || !phone) {
      return res.status(400).json({ error: 'Name and phone are required' });
    }

    // Authenticate first to get session
    console.log('  Authenticating...');
    const authResponse = await odooClient.post(`${ODOO_URL}/web/session/authenticate`, {
      jsonrpc: '2.0',
      method: 'call',
      params: {
        db: DB,
        login: USERNAME,
        password: PASSWORD,
      },
    });

    if (!authResponse.data.result?.uid) {
      console.error('❌ Auth failed');
      return res.status(401).json({ error: 'Authentication failed' });
    }

    sessionId = authResponse.data.result.uid;
    console.log('✓ Auth successful, Session ID:', sessionId);

    // Create contact with authenticated session
    console.log('  Creating contact in Odoo...');
    const createResponse = await odooClient.post(
      `${ODOO_URL}/web/dataset/call_kw/res.partner/create`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'res.partner',
          method: 'create',
          args: [{ name, phone }],
          kwargs: {},
        },
      }
    );

    if (createResponse.data.result) {
      console.log('✓ Contact created:', createResponse.data.result);
      res.json({
        success: true,
        result: createResponse.data.result,
        message: `Contact ${name} created successfully!`
      });
    } else {
      console.error('❌ Create failed:', createResponse.data.error);
      res.status(500).json({ 
        error: 'Failed to create contact',
        details: createResponse.data.error 
      });
    }
  } catch (error) {
    console.error('❌ Create error:', error.message);
    res.status(500).json({ 
      error: 'Failed to create contact',
      message: error.message 
    });
  }
});

// Fetch contacts
app.get('/api/contacts', async (req, res) => {
  try {
    console.log('📋 Fetching contacts...');

    // Authenticate first
    const authResponse = await odooClient.post(`${ODOO_URL}/web/session/authenticate`, {
      jsonrpc: '2.0',
      method: 'call',
      params: {
        db: DB,
        login: USERNAME,
        password: PASSWORD,
      },
    });

    if (!authResponse.data.result?.uid) {
      return res.status(401).json({ error: 'Authentication failed' });
    }

    const fetchResponse = await odooClient.post(
      `${ODOO_URL}/web/dataset/call_kw/res.partner/search_read`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'res.partner',
          method: 'search_read',
          args: [[]],
          kwargs: {
            fields: ['id', 'name', 'email', 'phone'],
            limit: 20,
          },
        },
      }
    );

    console.log('✓ Fetched contacts');
    res.json(fetchResponse.data);
  } catch (error) {
    console.error('❌ Fetch error:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch contacts',
      message: error.message 
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not found',
    message: 'This endpoint does not exist',
    path: req.path
  });
});

// Error handler
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✓ Backend proxy running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`API docs: http://localhost:${PORT}/`);
  console.log(`Ready to accept requests`);
});