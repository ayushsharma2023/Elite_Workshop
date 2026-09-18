const weatherState = {
  latitude: 51.5072,
  longitude: -0.1276,
  city: 'London',
  country: 'United Kingdom'
};

const weatherCodes = {
  0: ['Clear sky', '☀︎'], 1: ['Mainly clear', '◐'], 2: ['Partly cloudy', '◐'], 3: ['Overcast', '☁'],
  45: ['Foggy', '≋'], 48: ['Rime fog', '≋'], 51: ['Light drizzle', '⌁'], 53: ['Drizzle', '⌁'], 55: ['Heavy drizzle', '⌁'],
  61: ['Light rain', '☂'], 63: ['Rain', '☂'], 65: ['Heavy rain', '☂'], 71: ['Light snow', '✳'], 73: ['Snow', '✳'], 75: ['Heavy snow', '✳'],
  80: ['Rain showers', '☂'], 81: ['Rain showers', '☂'], 82: ['Heavy showers', '☂'], 95: ['Thunderstorm', 'ϟ'], 96: ['Storm', 'ϟ'], 99: ['Storm', 'ϟ']
};

const $ = (id) => document.getElementById(id);
const setText = (id, value) => { $(id).textContent = value; };

function setStatus(message = '') { $('statusMessage').textContent = message; }
function formatTime(value) { return value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'; }
function formatDate() { setText('currentDate', new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })); }

async function getWeather() {
  const params = new URLSearchParams({ latitude: weatherState.latitude, longitude: weatherState.longitude, current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m', daily: 'temperature_2m_max,temperature_2m_min,sunrise,sunset', timezone: 'auto', forecast_days: 1 });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!response.ok) throw new Error('Weather service is unavailable right now.');
  const data = await response.json();
  const [description, icon] = weatherCodes[data.current.weather_code] || ['Changing skies', '☁'];
  setText('locationName', `${weatherState.city}, ${weatherState.country}`);
  setText('weatherDescription', description);
  setText('weatherIcon', icon);
  setText('temperature', Math.round(data.current.temperature_2m));
  setText('feelsLike', `${Math.round(data.current.apparent_temperature)}°`);
  setText('windSpeed', `${Math.round(data.current.wind_speed_10m)} km/h`);
  setText('humidity', `${data.current.relative_humidity_2m}%`);
  setText('highTemp', `${Math.round(data.daily.temperature_2m_max[0])}°`);
  setText('lowTemp', `${Math.round(data.daily.temperature_2m_min[0])}°`);
  setText('sunrise', formatTime(data.daily.sunrise[0]));
  setText('sunset', formatTime(data.daily.sunset[0]));
}

async function getNews() {
  const response = await fetch('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=4');
  if (!response.ok) throw new Error('News service is unavailable right now.');
  const data = await response.json();
  const list = $('newsList');
  list.innerHTML = '';
  data.hits.filter((story) => story.title).slice(0, 4).forEach((story, index) => {
    const link = document.createElement('a');
    link.className = 'news-item';
    link.href = story.url || `https://news.ycombinator.com/item?id=${story.objectID}`;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.innerHTML = `<span class="story-number">0${index + 1}</span><span><span class="story-title">${escapeHtml(story.title)}</span><span class="story-meta">${story.points || 0} points · ${story.num_comments || 0} comments</span></span>`;
    list.appendChild(link);
  });
}

function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }

async function loadDashboard() {
  setStatus('');
  $('refreshButton').disabled = true;
  $('refreshButton').style.opacity = '.55';
  const results = await Promise.allSettled([getWeather(), getNews()]);
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) setStatus(failed.reason.message);
  $('refreshButton').disabled = false;
  $('refreshButton').style.opacity = '1';
}

async function findLocation(event) {
  event.preventDefault();
  const query = $('locationInput').value.trim();
  if (!query) return;
  setStatus('Finding that place...');
  try {
    const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`);
    const data = await response.json();
    if (!data.results?.length) throw new Error('We could not find that place. Try a nearby city.');
    const result = data.results[0];
    Object.assign(weatherState, { latitude: result.latitude, longitude: result.longitude, city: result.name, country: result.country });
    await getWeather();
    setStatus('');
  } catch (error) { setStatus(error.message); }
}

$('locationForm').addEventListener('submit', findLocation);
$('refreshButton').addEventListener('click', loadDashboard);
formatDate();
loadDashboard();
