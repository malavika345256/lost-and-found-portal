(() => {
  const center = [12.72976, 77.70876]; // Verified Alliance University campus feature coordinate; not a building location.
  const endpoint = new URL('/api/map/lost-items', window.location.origin);
  const filters = ['mapDateFrom', 'mapDateTo', 'mapCategory', 'mapStatus'].map(id => document.getElementById(id));
  const loading = document.getElementById('mapLoading');
  const errorBox = document.getElementById('mapError');
  const emptyBox = document.getElementById('mapEmpty');
  const results = document.getElementById('mapResults');
  const categorySelect = document.getElementById('mapCategory');
  const locationList = document.getElementById('locationList');
  const missingLocation = document.getElementById('mapMissingLocation');
  let map = null;
  let campusCircle = null;
  let requestNumber = 0;

  function ensureMap() {
    if (map || !window.L) return;
    map = L.map('campusMap', { scrollWheelZoom: false }).setView(center, 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    campusCircle = L.circleMarker(center, { radius: 14, color: '#fff', weight: 2, fillColor: '#94a3b8', fillOpacity: .78 }).addTo(map);
  }

  function colorForCount(count) {
    if (!count) return '#94a3b8';
    if (count <= 3) return '#f6ad55';
    if (count <= 10) return '#e76f51';
    return '#b42318';
  }

  function makeCampusPopup(summary) {
    const content = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = 'Alliance University campus aggregate';
    const total = document.createElement('p');
    total.textContent = `${summary.totalReports} matching lost report${summary.totalReports === 1 ? '' : 's'}`;
    content.append(title, total);
    const top = (summary.commonCategories || []).slice(0, 3);
    if (top.length) {
      const categories = document.createElement('p');
      categories.textContent = `Common categories: ${top.map(item => `${item.name} (${item.count})`).join(', ')}`;
      content.append(categories);
    }
    const note = document.createElement('small');
    note.textContent = 'This circle is campus-wide; it does not identify a building or item position.';
    content.append(note);
    return content;
  }

  function renderLocations(locations) {
    locationList.replaceChildren();
    const maxCount = Math.max(1, ...locations.map(location => location.reportCount));
    for (const [index, location] of locations.entries()) {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.className = 'location-toggle';
      button.type = 'button';
      button.setAttribute('aria-expanded', 'false');
      const detailsId = `location-details-${index}`;
      button.setAttribute('aria-controls', detailsId);
      const name = document.createElement('span');
      name.className = 'location-name';
      name.textContent = location.name;
      const count = document.createElement('span');
      count.className = 'location-count';
      count.textContent = `${location.reportCount} report${location.reportCount === 1 ? '' : 's'}`;
      const bar = document.createElement('span');
      bar.className = 'location-bar';
      const fill = document.createElement('span');
      fill.style.width = `${Math.max(4, (location.reportCount / maxCount) * 100)}%`;
      fill.style.background = colorForCount(location.reportCount);
      bar.append(fill);
      button.append(name, count, bar);
      const detail = document.createElement('div');
      detail.className = 'location-details';
      detail.id = detailsId;
      detail.hidden = true;
      if (location.categories?.length) {
        for (const category of location.categories) {
          const tag = document.createElement('span');
          tag.textContent = `${category.name}: ${category.count}`;
          detail.append(tag);
        }
      }
      const reportsHeading = document.createElement('p');
      reportsHeading.style.fontWeight = '700';
      reportsHeading.style.marginTop = '8px';
      reportsHeading.textContent = 'Lost reports at this location';
      detail.append(reportsHeading);
      if (location.items?.length) {
        for (const item of location.items) {
          const row = document.createElement('p');
          const link = document.createElement('a');
          link.href = `item.html?id=${encodeURIComponent(item.id)}&return=${encodeURIComponent('map.html')}`;
          link.textContent = `${item.itemName} · ${item.category} · ${new Date(item.date).toLocaleDateString()} · ${item.status}`;
          row.append(link);
          detail.append(row);
        }
      } else {
        const noReports = document.createElement('span');
        noReports.textContent = 'No report details are available for this location.';
        detail.append(noReports);
      }
      button.addEventListener('click', () => {
        const isExpanded = button.getAttribute('aria-expanded') === 'true';
        button.setAttribute('aria-expanded', String(!isExpanded));
        detail.hidden = isExpanded;
      });
      li.append(button, detail);
      locationList.append(li);
    }
  }

  function updateCategoryOptions(options) {
    const selected = categorySelect.value;
    categorySelect.replaceChildren(new Option('All categories', 'all'));
    for (const category of options) categorySelect.add(new Option(category, category));
    if ([...categorySelect.options].some(option => option.value === selected)) categorySelect.value = selected;
  }

  async function loadMapData() {
    const currentRequest = ++requestNumber;
    const params = new URLSearchParams();
    const [from, to, category, status] = filters.map(input => input.value.trim());
    if (from) params.set('dateFrom', from);
    if (to) params.set('dateTo', to);
    if (category && category !== 'all') params.set('category', category);
    if (status && status !== 'all') params.set('status', status);
    loading.hidden = false;
    errorBox.hidden = true;
    try {
      endpoint.search = params.toString();
      const response = await fetch(endpoint, { credentials: 'include', headers: { Accept: 'application/json' } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`${data.message || 'Could not load map data.'} (HTTP ${response.status} from ${endpoint.pathname})`);
      if (currentRequest !== requestNumber) return;
      updateCategoryOptions(data.categoryOptions || []);
      const summary = data.summary || { totalReports: 0, mostFrequentLocation: '', mostFrequentCount: 0, missingLocationReports: 0, commonCategories: [] };
      document.getElementById('mapTotal').textContent = summary.totalReports;
      document.getElementById('mapMostLocation').textContent = summary.mostFrequentLocation ? `${summary.mostFrequentLocation} (${summary.mostFrequentCount})` : '—';
      document.getElementById('mapLocationCount').textContent = summary.locationCount || 0;
      document.getElementById('mapResolvedCount').textContent = summary.resolvedReportCount || 0;
      const missingCount = summary.missingLocationReports || 0;
      missingLocation.textContent = missingCount ? `${missingCount} report${missingCount === 1 ? '' : 's'} have no recorded location and are omitted from location groups.` : '';
      missingLocation.hidden = !missingCount;
      renderLocations(data.locations || []);
      document.getElementById('locationEmpty').hidden = (data.locations || []).length > 0;
      emptyBox.hidden = summary.totalReports > 0;
      results.hidden = summary.totalReports === 0;
      ensureMap();
      if (campusCircle) {
        const count = summary.totalReports || 0;
        campusCircle.setStyle({ fillColor: colorForCount(count) });
        campusCircle.setRadius(count ? Math.min(48, 14 + Math.sqrt(count) * 6) : 14);
        campusCircle.unbindPopup();
        campusCircle.bindPopup(makeCampusPopup(summary));
      }
      if (map) window.setTimeout(() => map.invalidateSize(), 0);
      if (!window.L) {
        errorBox.textContent = 'The interactive map library could not load. The location counts and category summaries are still available.';
        errorBox.hidden = false;
      }
    } catch (error) {
      if (currentRequest !== requestNumber) return;
      errorBox.textContent = `${error.message} Check that the current project server is running at ${window.location.origin}, then reload or adjust the filters.`;
      errorBox.hidden = false;
    } finally {
      if (currentRequest === requestNumber) loading.hidden = true;
    }
  }

  filters.forEach(input => input.addEventListener('change', () => {
    const from = document.getElementById('mapDateFrom'), to = document.getElementById('mapDateTo');
    to.setCustomValidity(from.value && to.value && from.value > to.value ? 'To date must be on or after From date.' : '');
    if (!to.reportValidity()) return;
    loadMapData();
  }));
  loadMapData();
})();
