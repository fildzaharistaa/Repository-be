const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
dotenv.config();

const token = jwt.sign(
  { sub: 'b0401f17-3e53-4565-a8fe-fead53567254', role: 'Super Admin' },
  process.env.JWT_SECRET || 'default-secret-key',
  { expiresIn: '1h' }
);
console.log('Token:', token);
