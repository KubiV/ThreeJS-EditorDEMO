import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const PORT = process.env.PORT || 3000;

// Get __dirname equivalent in ES module scope
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Serve node_modules for dependencies
app.use('/node_modules', express.static(path.join(__dirname, 'node_modules')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/editor.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'editor.html'));
});

// Example route for handling label updates
app.post('/savePoints', (req, res) => {
    const points = req.body.points; // Assuming points are sent as JSON in the request body

    // Here, you would update your labels array or database with the received points
    points.forEach(point => {
        labels.push({
            text: "",
            surfacePoint: point.surfacePoint,
            secondPoint: point.secondPoint
        });
    });

    // Optionally, save the updated labels to a file or database
    // Example: saving to a file (you would need appropriate permissions)
    const fs = require('fs');
    const labelsString = `export const labels = ${JSON.stringify(labels, null, 4)};\n`;
    fs.writeFileSync('./labels.js', labelsString, 'utf8');

    // Send a response back to the client
    res.send('Points saved successfully');
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
