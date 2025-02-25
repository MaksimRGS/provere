self.addEventListener('push', function (event) {
    const data = event.data.json();

    const options = {
        body: data.body,
        icon: 'favicon-16x16.png',
        badge: 'favicon-16x16.png',
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

self.addEventListener('notificationclick', function (event) {
    event.notification.close();
    event.waitUntil(
        clients.openWindow(data.url || '/')
    );
});
