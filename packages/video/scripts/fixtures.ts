/** Elle yazılmış test varlıkları: sahne fiziği ve çizgi stillerini token harcamadan denemek için. */

export const character = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 800">
  <g id="leg-l"><rect x="155" y="505" width="42" height="140" rx="20" fill="#2b3a55" stroke="#1b1f2a" stroke-width="4"/>
    <g id="shin-l"><rect x="157" y="615" width="38" height="130" rx="18" fill="#2b3a55" stroke="#1b1f2a" stroke-width="4"/><ellipse cx="168" cy="748" rx="38" ry="15" fill="#1a1a1a"/></g></g>
  <g id="leg-r"><rect x="203" y="505" width="42" height="140" rx="20" fill="#2b3a55" stroke="#1b1f2a" stroke-width="4"/>
    <g id="shin-r"><rect x="205" y="615" width="38" height="130" rx="18" fill="#2b3a55" stroke="#1b1f2a" stroke-width="4"/><ellipse cx="234" cy="748" rx="38" ry="15" fill="#1a1a1a"/></g></g>
  <g id="body"><path d="M128 290 Q200 262 272 290 L286 540 Q200 562 114 540 Z" fill="#c8553d" stroke="#1b1f2a" stroke-width="4"/><path d="M200 280 L286 540 Q240 556 200 558 Z" fill="#a8432f"/></g>
  <g id="arm-l"><rect x="120" y="285" width="38" height="130" rx="19" fill="#c8553d" stroke="#1b1f2a" stroke-width="4"/>
    <g id="forearm-l"><rect x="122" y="385" width="34" height="120" rx="17" fill="#c8553d" stroke="#1b1f2a" stroke-width="4"/><g id="hand-l"><circle cx="139" cy="512" r="21" fill="#f2c79b" stroke="#1b1f2a" stroke-width="4"/></g></g></g>
  <g id="arm-r"><rect x="242" y="285" width="38" height="130" rx="19" fill="#c8553d" stroke="#1b1f2a" stroke-width="4"/>
    <g id="forearm-r"><rect x="244" y="385" width="34" height="120" rx="17" fill="#c8553d" stroke="#1b1f2a" stroke-width="4"/><g id="hand-r"><circle cx="261" cy="512" r="21" fill="#f2c79b" stroke="#1b1f2a" stroke-width="4"/></g></g></g>
  <g id="head">
    <rect x="184" y="228" width="32" height="44" fill="#e0b088"/>
    <circle cx="200" cy="170" r="82" fill="#f2c79b" stroke="#1b1f2a" stroke-width="4"/>
    <path d="M200 88 A82 82 0 0 1 282 170 L282 175 Q250 160 240 120 Q210 140 200 88Z" fill="#e0b088" opacity="0.6"/>
    <path d="M118 160 Q130 80 200 82 Q275 80 284 160 Q260 115 200 118 Q140 115 118 160 Z" fill="#3b2a20"/>
    <g id="brows"><rect x="156" y="140" width="32" height="8" rx="4" fill="#3b2a20"/><rect x="212" y="140" width="32" height="8" rx="4" fill="#3b2a20"/></g>
    <g id="eyes"><ellipse cx="172" cy="170" rx="10" ry="13" fill="#222"/><ellipse cx="228" cy="170" rx="10" ry="13" fill="#222"/><circle cx="175" cy="166" r="3" fill="#fff"/><circle cx="231" cy="166" r="3" fill="#fff"/></g>
    <path d="M200 178 Q194 196 202 198" fill="none" stroke="#b9805a" stroke-width="4" stroke-linecap="round"/>
    <g id="mouth"><path d="M178 212 Q200 228 222 212 Q200 238 178 212 Z" fill="#8a3b2e"/></g>
  </g>
</svg>`;

/** Mobilyasız oda kabuğu: duvar, pencere, zemin (zemin çizgisi y=700). */
export const room = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080">
  <rect width="1920" height="700" fill="#cfd8d3"/>
  <rect x="1260" y="150" width="420" height="300" rx="8" fill="#9fc6e8" stroke="#2a2f3a" stroke-width="6"/>
  <line x1="1470" y1="150" x2="1470" y2="450" stroke="#2a2f3a" stroke-width="6"/>
  <rect y="690" width="1920" height="20" fill="#b9c4be"/>
  <rect y="700" width="1920" height="380" fill="#8b7a6a"/>
</svg>`;

export const desk = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300">
  <rect x="10" y="10" width="580" height="40" rx="6" fill="#a8744f" stroke="#2a2f3a" stroke-width="5"/>
  <rect x="30" y="50" width="200" height="250" fill="#8d5f3e" stroke="#2a2f3a" stroke-width="5"/>
  <rect x="540" y="50" width="34" height="250" fill="#8d5f3e" stroke="#2a2f3a" stroke-width="5"/>
  <rect x="60" y="90" width="140" height="60" rx="4" fill="#a8744f" stroke="#2a2f3a" stroke-width="4"/>
</svg>`;

export const chair = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400">
  <rect x="40" y="10" width="220" height="180" rx="16" fill="#3e6b8a" stroke="#2a2f3a" stroke-width="5"/>
  <rect x="20" y="190" width="260" height="40" rx="10" fill="#4f84a8" stroke="#2a2f3a" stroke-width="5"/>
  <rect x="40" y="230" width="20" height="170" fill="#2a2f3a"/><rect x="240" y="230" width="20" height="170" fill="#2a2f3a"/>
</svg>`;

export const chip = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  ${Array.from({ length: 5 }, (_, i) => `<rect x="${42 + i * 26}" y="20" width="10" height="30" fill="#c9a227"/><rect x="${42 + i * 26}" y="150" width="10" height="30" fill="#c9a227"/>`).join("")}
  <rect x="25" y="45" width="150" height="110" rx="10" fill="#1c232c" stroke="#2a2f3a" stroke-width="4"/>
  <rect x="70" y="80" width="60" height="40" rx="4" fill="none" stroke="#7fd1ff" stroke-width="4"/>
</svg>`;

export const clock = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <circle cx="100" cy="100" r="90" fill="#fdfaf2" stroke="#2a2f3a" stroke-width="8"/>
  <line x1="100" y1="100" x2="100" y2="40" stroke="#2a2f3a" stroke-width="8" stroke-linecap="round"/>
  <line x1="100" y1="100" x2="145" y2="115" stroke="#2a2f3a" stroke-width="6" stroke-linecap="round"/>
</svg>`;
