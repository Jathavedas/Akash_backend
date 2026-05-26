const express = require('express');
const router = express.Router();
const Service = require('../models/Service');
const Project = require('../models/Project');
const upload = require('../middlewares/upload');
const { cloudinary } = require('../config/cloudinary');

// --- SERVICES ROUTES ---
router.get('/services', async (req, res) => {
  try {
    const services = await Service.find();
    res.json(services);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/services', async (req, res) => {
  const service = new Service({
    title: req.body.title,
    desc: req.body.desc,
    features: req.body.features || []
  });
  try {
    const newService = await service.save();
    res.status(201).json(newService);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.delete('/services/:id', async (req, res) => {
  try {
    await Service.findByIdAndDelete(req.params.id);
    res.json({ message: 'Service deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// --- PROJECTS ROUTES ---
router.get('/projects', async (req, res) => {
  try {
    const projects = await Project.find();
    res.json(projects);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create project with image upload to Cloudinary
router.post('/projects', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No image uploaded' });
  }
  const project = new Project({
    title: req.body.title,
    location: req.body.location,
    type: req.body.type,
    status: req.body.status,
    image: req.file.path // Cloudinary URL
  });
  try {
    const newProject = await project.save();
    res.status(201).json(newProject);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.delete('/projects/:id', async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });
    
    // Delete image from Cloudinary if it exists
    if (project.image) {
      try {
        const parts = project.image.split('/');
        const filenameWithExt = parts.pop();
        const folder = parts.pop();
        const filename = filenameWithExt.split('.')[0];
        const publicId = `${folder}/${filename}`;
        
        await cloudinary.uploader.destroy(publicId);
      } catch (cloudinaryErr) {
        console.error('Error deleting image from Cloudinary:', cloudinaryErr);
      }
    }

    await Project.findByIdAndDelete(req.params.id);
    res.json({ message: 'Project and associated image deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
