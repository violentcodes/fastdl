async function getCobaltInstances() {
  try {
    const res = await fetch('https://instances.cobalt.best/api/instances');
    if (res.ok) {
      const data = await res.json();
      console.log('API RESPONSE ARRAY LENGTH:', data.length);
      console.log('FIRST 5 INSTANCES:', JSON.stringify(data.slice(0, 5), null, 2));
    } else {
      console.log('FAIL:', res.status);
      const text = await res.text();
      console.log(text.slice(0, 500));
    }
  } catch (err) {
    console.error('ERROR:', err);
  }
}

getCobaltInstances();
