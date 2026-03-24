// Extract the custom protocol URL from the fragment and navigate to it
const protocolUrl = decodeURIComponent(window.location.hash.slice(1));
if (protocolUrl) {
  window.location.href = protocolUrl;
}
