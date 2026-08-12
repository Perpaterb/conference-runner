import '@testing-library/jest-dom/vitest'

// jsdom does not implement element scrolling, which the timeline's snap-to-now uses.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {}
}
