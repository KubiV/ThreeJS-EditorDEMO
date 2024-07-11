import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const app = express();
const PORT = process.env.PORT || 3000;

// Get __dirname equivalent in ES module scope
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware to parse JSON bodies
app.use(express.json());

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

app.post('/save-point', (req, res) => {
    const newPoint = req.body;
    console.log("Received new point:", newPoint);

    // Načtení aktuálního obsahu souboru labels.json
    fs.readFile('./public/labels.json', 'utf8', (err, data) => {
        if (err && err.code !== 'ENOENT') {
            return res.status(500).send('Error reading file');
        }

        let labels = { labels: [] };

        if (!err) {
            labels = JSON.parse(data);
        }

        // Přidání nového bodu
        labels.labels.push(newPoint);

        // Uložení do souboru labels.json
        fs.writeFile('./public/labels.json', JSON.stringify(labels, null, 2), (err) => {
            if (err) {
                return res.status(500).send('Error writing file');
            }
            res.status(200).send('Point saved successfully');
        });
    });
});


app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
