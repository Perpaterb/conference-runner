import '@testing-library/jest-dom/vitest'

// jsdom does not implement element scrolling, which the timeline's snap-to-now uses.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {}
}

// jsdom implements neither of these; every real browser does.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}
