async function start() {
    const { default: app } = await import('./app.js');
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
      console.log(`App listening on port ${port}`);
    });
  }
  
  start().catch((err) => {
    console.error('Error starting app:', err);
  });
  