const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/scrape-terna', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Falta usuario o contraseña' });

    let browser;
    try {
        console.log(`\n[+] Iniciando extracción para: ${username}`);
        // AJUSTES VITALES PARA LA NUBE
        browser = await puppeteer.launch({ 
            headless: true, 
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ] 
        });
        const page = await browser.newPage();

        console.log(`[+] Entrando al portal...`);
        await page.goto('https://iutso.terna.net/', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 3000)); 

        const loginSuccess = await page.evaluate((u, p) => {
            const inputs = Array.from(document.querySelectorAll('input')).filter(i => i.getBoundingClientRect().width > 0);
            const textInput = inputs.find(i => i.type === 'text' || i.type === 'email');
            const passInput = inputs.find(i => i.type === 'password');
            const btn = document.querySelector('button[type="submit"], input[type="submit"], button.btn');

            if (textInput && passInput) {
                textInput.value = u;
                passInput.value = p;
                if (btn) btn.click();
                else passInput.closest('form').submit();
                return true;
            }
            return false;
        }, username, password);

        if (!loginSuccess) {
            await page.keyboard.type(username);
            await page.keyboard.press('Tab');
            await page.keyboard.type(password);
            await page.keyboard.press('Enter');
        }

        await new Promise(r => setTimeout(r, 4000)); 

        const currentUrl = page.url();
        const hasLoginError = await page.evaluate(() => {
            const errBox = document.querySelector('.alert-danger, .error, .toast');
            return errBox ? errBox.innerText : null;
        });

        if (currentUrl.includes('login') || currentUrl === 'https://iutso.terna.net/' || hasLoginError) {
            throw new Error(`Contraseña o usuario incorrecto.`);
        }

        await page.goto('https://iutso.terna.net/VerNotasLapso.php?mid=0', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 3000));

        const isBlocked = await page.evaluate(() => {
            const text = document.body.innerText.toLowerCase();
            return text.includes('mora administrativa') || text.includes('error adm');
        });

        if (isBlocked) throw new Error(`ERROR ADM: Mora Administrativa.`);

        const data = await page.evaluate(() => {
            const subjects = [];
            const evaluations = [];
            const colors = ['blue', 'purple', 'teal', 'orange', 'pink', 'green'];
            let colorIdx = 0;
            let currentSubjectId = null;
            const rows = document.querySelectorAll('table tr');

            rows.forEach(row => {
                const text = row.innerText.trim();
                if (!text) return;

                const firstCell = row.cells[0];
                const isHeaderRow = row.cells.length === 1 || (firstCell && firstCell.colSpan >= 2);

                if (isHeaderRow && !text.toLowerCase().includes('descripci') && !text.toLowerCase().includes('escala')) {
                    const match = text.match(/^([A-Z0-9]+(?:\(\d+\))?)\s+.*?\s+(.+)$/i) || text.match(/^([A-Z0-9]+)\s+(.+)$/i);
                    currentSubjectId = `t-sub-${Math.random().toString(36).substr(2,9)}`;
                    if (match) {
                        subjects.push({ id: currentSubjectId, name: match[2].trim(), code: match[1].trim(), credits: parseInt(match[1].match(/\((\d+)\)/)?.[1] || 3), university: 'IUTSO', color: colors[colorIdx % colors.length] });
                    } else {
                        subjects.push({ id: currentSubjectId, name: text, code: `MAT-${Math.floor(Math.random()*1000)}`, credits: 3, university: 'IUTSO', color: colors[colorIdx % colors.length] });
                    }
                    colorIdx++;
                    return; 
                }

                if (currentSubjectId && row.cells.length >= 4) {
                    const desc = firstCell.innerText.trim();
                    const descLower = desc.toLowerCase();
                    if (!desc || descLower === 'descripción' || descLower.includes('definitiva') || descLower.includes('previa') || descLower.includes('recuperaci') || descLower.includes('inasistencia')) return;

                    let nota = parseFloat(row.cells[1].innerText.trim().replace(',', '.'));
                    let peso = parseFloat(row.cells[3].innerText.trim().replace(',', '.'));
                    if (isNaN(peso)) return;

                    const dateMatch = desc.match(/(\d{2}-\d{2}-\d{4})/);
                    let dateObj = ''; 
                    if (dateMatch) {
                        const parts = dateMatch[1].split('-');
                        dateObj = `${parts[2]}-${parts[1]}-${parts[0]}`; 
                    }

                    let cleanName = dateMatch ? desc.replace(dateMatch[1], '').replace(/\s+/g, ' ').trim() : desc;
                    const hasGrade = !isNaN(nota) && nota >= 0;

                    evaluations.push({
                        id: `ev-${Math.random().toString(36).substr(2,9)}`,
                        subject_id: currentSubjectId,
                        name: cleanName.substring(0, 90), weight: peso, date: dateObj,
                        grade: hasGrade ? nota : null, completed: hasGrade,
                        description: 'Extraído automáticamente desde TernaNet'
                    });
                }
            });
            return { subjects, evaluations };
        });

        await browser.close();
        res.json(data);
    } catch (error) {
        if (browser) await browser.close();
        res.status(500).json({ error: error.message });
    }
});

// EL PUERTO DEBE SER DINÁMICO EN LA NUBE
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Robot activo en el puerto ${PORT}`));