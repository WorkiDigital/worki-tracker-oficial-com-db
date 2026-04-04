import { cors } from './_cors.js';

export default async function handler(req, res) {
  if (cors(req, res, ['GET'], { public: true })) return;

  // Exposes only public config
  return res.status(200).json({
    projectName: process.env.PROJECT_NAME || 'Adlytics'
  });
}
