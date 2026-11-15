const { initDatabase } = require('../src/db/database');

beforeAll(async () => {
  await initDatabase();
});
