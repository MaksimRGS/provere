const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const cors = require('cors');
const path = require('path');
const fsp = require('fs').promises;
const webPush = require('web-push');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

let token = null;
const activitiesFile = path.join(__dirname, 'testings.json');
const subscriptionsFile = path.join(__dirname, 'subscriptions.json');
const apiActivitiesFile = path.join(__dirname, 'API.json');
const lektireFile = path.join(__dirname, 'lektire.json');

const restrictIP = (req, res, next) => {
    const allowedIPs = process.env.ALLOWED_IPS.split(',');
    const forwardedFor = req.headers['x-forwarded-for'];
    const clientIP = forwardedFor ? forwardedFor.split(',')[0].trim() : req.socket.remoteAddress;
    const normalizedIP = clientIP.startsWith('::ffff:') ? clientIP.slice(7) : clientIP;

    if (allowedIPs.includes(normalizedIP)) {
        next();
    } else {
        res.status(403).json({
            error: `Access denied. Your IP is not allowed to use this endpoint. Your IP is ${normalizedIP}`
        });
    }
};

const vapidKeys = {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
};

webPush.setVapidDetails(
'mailto:' + process.env.VAPID_EMAIL,
    vapidKeys.publicKey,
    vapidKeys.privateKey
);

const fetchToken = async () => {
    try {
        const response = await axios.post('https://smartdnevnik.smart.edu.rs/api/authentication', {
            userName: process.env.SMART_USERNAME,
            password: process.env.SMART_PASSWORD,
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9,sr-RS;q=0.8,sr;q=0.7,de;q=0.6',
                'Connection': 'keep-alive',
                'Origin': 'https://smartdnevnik.smart.edu.rs',
                'Referer': 'https://smartdnevnik.smart.edu.rs/login',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            }
        });
        token = response.data.token;
        console.log('Token fetched successfully:', token);
    } catch (error) {
        console.error('Error fetching token:', error.response?.data || error.message);
    }
};

cron.schedule('*/2 * * * *', fetchToken);

const loadActivities = async () => {
    try {
        const data = await fsp.readFile(activitiesFile, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
    }
};

const saveActivities = async (activities) => {
    await fsp.writeFile(activitiesFile, JSON.stringify(activities, null, 4));
};

const loadSubscriptions = async () => {
    try {
        const data = await fsp.readFile(subscriptionsFile, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
    }
};

const saveSubscriptions = async (subscriptions) => {
    await fsp.writeFile(subscriptionsFile, JSON.stringify(subscriptions, null, 4));
};

const saveAPIActivities = async (activities) => {
    try {
        await fsp.writeFile(apiActivitiesFile, JSON.stringify(activities, null, 4));
        console.log('Activities saved to API.json');
    } catch (err) {
        console.error('Error saving API activities:', err.message);
    }
};

const loadLektire = async () => {
    try {
        const data = await fsp.readFile(lektireFile, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
    }
};

const saveLektire = async (lektire) => {
    await fsp.writeFile(lektireFile, JSON.stringify(lektire, null, 4));
};

const sendTomorrowActivityNotifications = async () => {
    try {
        if (!token) {
            console.log('Token not available for sending notifications');
            return;
        }

        console.log('Fetching activities from API...');

        const startDate = '09-01-2024';
        const endDate = '08-31-2025';

        let apiActivities = [];
        try {
            const response = await axios.get(`https://smartdnevnik.smart.edu.rs/api/actionplanning/actionplanningreport/2a1ac722-ecf2-44c5-babd-502ff91097dd/${startDate}/${endDate}`, {
                headers: {
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Language': 'en-US,en;q=0.9,sr-RS;q=0.8,sr;q=0.7,de;q=0.6',
                    'Connection': 'keep-alive',
                    'Content-Type': 'application/json',
                    'Referer': 'https://smartdnevnik.smart.edu.rs/parent_student_reports/action_planning_report',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                    'token': token,
                },
            });
            apiActivities = response.data;
            console.log(`Fetched ${apiActivities.length} activities from API`);

            await saveAPIActivities(apiActivities);
            console.log('Activities saved to API.json');
        } catch (error) {
            console.error('Error fetching activities from API:', error.message);
        }

        const activitiesFromFile = await loadAPIActivities();
        console.log(`Loaded ${activitiesFromFile.length} activities from API.json`);

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];

        const tomorrowActivities = activitiesFromFile.filter(activity =>
            activity.date.startsWith(tomorrowStr) &&
            (!activity.notificationSent || activity.notificationSent === false)
        );

        console.log(`Activities for tomorrow: ${tomorrowActivities.length}`);
        if (tomorrowActivities.length > 0) {
            const subscriptions = await loadSubscriptions();
            console.log(`Loaded ${subscriptions.length} subscriptions`);

            if (subscriptions.length === 0) {
                console.log('No subscriptions available for notifications');
                return;
            }

            const payload = JSON.stringify({
                title: 'Tomorrow\'s Activities',
                body: tomorrowActivities.map(activity =>
                    `${activity.subject.subjectName}: ${activity.description}`
                ).join('\n'),
                icon: 'favicon-16x16.png',
                badge: 'favicon-16x16.png',
            });

            const promises = subscriptions.map(sub =>
                webPush.sendNotification(sub, payload).catch(err => {
                    console.error('Error sending push notification:', err);
                })
            );

            await Promise.all(promises);
            console.log(`Notifications sent for ${tomorrowActivities.length} activities`);

            tomorrowActivities.forEach(activity => {
                activity.notificationSent = true;
            });

            await saveAPIActivities(activitiesFromFile);
            console.log('Updated activities saved to API.json');
        } else {
            console.log('No activities scheduled for tomorrow');
        }
    } catch (error) {
        console.error('Error in scheduled notifications:', error);
    }
};

const monthMapping = {
    'januar': 'january',
    'februar': 'february',
    'mart': 'march',
    'april': 'april',
    'maj': 'may',
    'jun': 'june',
    'jul': 'july',
    'avgust': 'august',
    'septembar': 'september',
    'oktobar': 'october',
    'novembar': 'november',
    'decembar': 'december'
};

async function sendLektireNotifications() {
    try {
        const lektire = await loadLektire();
        const today = new Date();
        const currentMonth = today.toLocaleDateString('sr-RS', { month: 'long' }).toLowerCase();
        const englishMonth = monthMapping[currentMonth] || currentMonth;

        for (const book of lektire) {
            if (book.month.toLowerCase() === currentMonth) {
                const message = {
                    title: `Lektira for ${englishMonth}`,
                    body: `"${book.title}" by ${book.author} is scheduled for this month`,
                    data: {
                        url: book.pdfUrl || '',
                        type: 'lektira',
                        id: book.id
                    }
                };
                await sendPushNotifications(message);
                console.log(`Sent notification for lektira: ${book.title}`);
            }
        }
    } catch (error) {
        console.error('Error sending lektire notifications:', error);
    }
}

cron.schedule('0 8 1 * *', sendLektireNotifications);

cron.schedule('0 0 * * *', sendTomorrowActivityNotifications);

app.get('/api/my-ip', (req, res) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    res.json({ ip });
});

app.post('/api/save-subscription', async (req, res) => {
    try {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const subscriptions = await loadSubscriptions();

        const existingSubscriptionIndex = subscriptions.findIndex(sub => sub.ip === ip);
        const newSubscription = { ...req.body, ip };

        if (existingSubscriptionIndex >= 0) {
            subscriptions[existingSubscriptionIndex] = newSubscription;
        } else {
            subscriptions.push(newSubscription);
        }

        await saveSubscriptions(subscriptions);
        res.json({ message: 'Subscription saved successfully', ip });
    } catch (error) {
        console.error('Error saving subscription:', error.message);
        res.status(500).json({ error: 'Failed to save subscription.' });
    }
});

const sendPushNotifications = async (message) => {
    const subscriptions = await loadSubscriptions();

    const payload = JSON.stringify({
        title: 'Activity Notification',
        body: message,
        icon: 'favicon-16x16.png',
        badge: 'favicon-16x16.png',
    });

    const promises = subscriptions.map(sub =>
        webPush.sendNotification(sub, payload).catch(err => {
            console.error('Error sending push notification:', err);
        })
    );

    await Promise.all(promises);
};

app.post('/api/add-activity', restrictIP, async (req, res) => {
    try {
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);

        const newActivity = {
            actionPlanningId: "f84ba942-04da-4af6-af34-5e4a4e89417a",
            description: "Kontrolni zadatak-Klase i objekti",
            date: tomorrow.toISOString().split('T')[0] + "T00:00:00",
            gradeId: "0bf8d30f-fc86-46f3-b4cd-05f9c8e7faaf",
            professorId: "d7464fed-06e8-4f62-97b5-b0abaa9909cf",
            subjectId: "640a330b-90d8-48a2-9ceb-27a7d53fd60d",
            grade: null,
            professor: {
                professorId: "d7464fed-06e8-4f62-97b5-b0abaa9909cf",
                professorName: "Maja Đaković",
                userId: "5091dada-9a04-4509-929d-a2fcda467b66",
            },
            subject: {
                subjectId: "640a330b-90d8-48a2-9ceb-27a7d53fd60d",
                subjectName: "Objektno orjentisano programiranje",
                subjectType: 10,
                markDescription: 10,
            },
            dateForDisplay: `${tomorrow.getDate()}/${tomorrow.getMonth() + 1}/${tomorrow.getFullYear()}`,
        };

        const activities = await loadActivities();
        activities.push(newActivity);
        await saveActivities(activities);

        await sendPushNotifications(`${newActivity.subject.subjectName} is scheduled for tomorrow.`);

        res.json({ message: "Activity added successfully", activity: newActivity });
    } catch (error) {
        console.error('Error adding activity:', error.message);
        res.status(500).json({ error: 'Failed to add activity.' });
    }
});

app.get('/api/action-report', async (req, res) => {
    if (!token) {
        return res.status(400).json({ error: 'Token not available. Please wait until the token is fetched.' });
    }

    const startDate = '09-01-2024';
    const endDate = '08-31-2025';

    try {
        const response = await axios.get(`https://smartdnevnik.smart.edu.rs/api/actionplanning/actionplanningreport/2a1ac722-ecf2-44c5-babd-502ff91097dd/${startDate}/${endDate}`, {
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9,sr-RS;q=0.8,sr;q=0.7,de;q=0.6',
                'Connection': 'keep-alive',
                'Content-Type': 'application/json',
                'Referer': 'https://smartdnevnik.smart.edu.rs/parent_student_reports/action_planning_report',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'token': token,
            },
        });

        const activities = await loadActivities();
        const finalResponse = [...activities, ...response.data];

        res.json(finalResponse);
    } catch (error) {
        console.error('Error fetching action report:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to fetch action report.' });
    }
});

app.get('/api/grades', restrictIP, async (req, res) => {
    if (!token) {
        return res.status(400).json({ error: 'Token not available. Please wait until the token is fetched.' });
    }

    try {
        const response = await axios.get('https://smartdnevnik.smart.edu.rs/api/parentstudentreport/evaluationreportforparentstudent/2a1ac722-ecf2-44c5-babd-502ff91097dd/1', {
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9,sr-RS;q=0.8,sr;q=0.7,de;q=0.6',
                'Connection': 'keep-alive',
                'Content-Type': 'application/json',
                'Referer': 'https://smartdnevnik.smart.edu.rs/api/parentstudentreport/evaluationreportforparentstudent/2a1ac722-ecf2-44c5-babd-502ff91097dd/1',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'token': token,
            },
        });
        res.json(response.data);
    } catch (error) {
        console.error('Error fetching grades:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to fetch grades.' });
    }
});

app.get('/api/absances', async (req, res) => {
    const STUDENT_ID = process.env.STUDENT_ID;
    const BASE_URL = 'https://smartdnevnik.smart.edu.rs/api/parentstudentreport';

    const REQUEST_HEADERS = {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9,sr-RS;q=0.8,sr;q=0.7,de;q=0.6',
        'Connection': 'keep-alive',
        'Content-Type': 'application/json',
        'Referer': `${BASE_URL}/absencesperstudent/${STUDENT_ID}/2`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/'
    };

    async function fetchAbsenceDetails(date) {
        const detailUrl = `${BASE_URL}/absenceperstudentdetails/${STUDENT_ID}/${date}`;

        try {
            const response = await fetch(detailUrl, {
                headers: {
                    ...REQUEST_HEADERS,
                    'token': token
                }
            });

            if (!response.ok) {
                throw new Error('Failed to fetch absence details');
            }

            return await response.json();
        } catch (error) {
            console.error('Absence details fetch error:', error);
            return null;
        }
    }

    function formatDateForAPI(dateString) {
        const [day, month, year] = dateString.split('/');
        return `${month}-${day}-${year}`;
    }

    if (!token) {
        return res.status(400).json({ error: 'Token not available. Please wait until the token is fetched.' });
    }

    try {
        const response = await axios.get(`${BASE_URL}/absencesperstudent/${STUDENT_ID}/1`, {
            headers: {
                ...REQUEST_HEADERS,
                'token': token,
            },
        });

        const detailedAbsences = await Promise.all(
            response.data.map(async (absence) => {
                const formattedDate = formatDateForAPI(absence.dateForDisplay);
                const details = await fetchAbsenceDetails(formattedDate);
                return {
                    ...absence,
                    details: details
                };
            })
        );

        res.json(detailedAbsences);
    } catch (error) {
        console.error('Error fetching absences:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to fetch absences.' });
    }
});

app.get('/api/get-lektire', async (req, res) => {
    try {
        const lektire = await loadLektire();
        res.json(lektire);
    } catch (error) {
        console.error('Error loading lektire:', error);
        res.status(500).json({ error: 'Failed to load lektire' });
    }
});

// Endpoint to add or edit lektira
app.post('/api/add-edit-lektira', async (req, res) => {
    try {
        const { id, title, author, month, date, pdfUrl } = req.body;
        
        if (!title || !author || !month) {
            return res.status(400).json({ error: 'Title, author, and month are required' });
        }

        const lektire = await loadLektire();
        
        if (id) {
            const index = lektire.findIndex(l => l.id === id);
            if (index === -1) {
                return res.status(404).json({ error: 'Lektira not found' });
            }
            
            lektire[index] = {
                id,
                title,
                author,
                month,
                date: date || 'N/A',
                pdfUrl: pdfUrl || ''
            };
        } else {
            const newLektira = {
                id: (lektire.length + 1).toString(), 
                title,
                author,
                month,
                date: date || 'N/A',
                pdfUrl: pdfUrl || ''
            };
            lektire.push(newLektira);
        }

        await saveLektire(lektire);
        res.json({ success: true, data: lektire });
    } catch (error) {
        console.error('Error handling lektira:', error);
        res.status(500).json({ error: 'Failed to process lektira' });
    }
});

app.get('/api/porn' , (req, res) => {
      res.json("Hi I am porn, oh you thought you would see porn. Well nah");
  })

  app.delete('/api/lektira/:id', restrictIP, async (req, res) => {
    try {
        const lektire = await loadLektire();
        const index = lektire.findIndex(l => l.id === req.params.id);
        if (index === -1) {
            return res.status(404).json({ error: 'Lektira not found' });
        }
        lektire.splice(index, 1);
        await saveLektire(lektire);
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting lektira:', error);
        res.status(500).json({ error: 'Failed to delete lektira' });
    }
})

const PORT = 3009;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    fetchToken(); 
});
