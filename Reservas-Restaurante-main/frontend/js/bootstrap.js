(function bootstrapReservaRest() {
  const backendOrigin = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'http://localhost:3000'
    : location.origin;

  function loadApp() {
    const app = document.createElement('script');
    app.src = 'js/app.js?v=11';
    app.defer = true;
    document.body.appendChild(app);
  }

  const socketClient = document.createElement('script');
  socketClient.src = `${backendOrigin}/socket.io/socket.io.js`;
  socketClient.defer = true;
  socketClient.onload = loadApp;
  socketClient.onerror = loadApp;
  document.body.appendChild(socketClient);
}());
