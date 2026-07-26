function fractionDigits(step) {
  return Math.min(4, Math.max(1, Math.ceil(-Math.log10(Number(step) || 0.1))));
}

export function lineLengthControlValues({ lineLength, minLineLength, maxLineLength, lineStep } = {}) {
  const step = Number(lineStep) || 0.1;
  const min = Number(minLineLength) || 0.0001;
  const max = Math.max(Number(maxLineLength) || 20, min + step);
  const value = Math.min(max, Math.max(min, Number(lineLength) || min));

  return { min, max, step, value, digits: fractionDigits(step) };
}

export function formatLineLength(value, lineStep) {
  const digits = fractionDigits(lineStep);
  return `${Number(value || 0).toLocaleString('cs-CZ', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })} jednotek`;
}

/** Shared range control for a label's leader-line length. */
export function lineLengthControlMarkup(options = {}) {
  const { min, max, step, value, digits } = lineLengthControlValues(options);
  return `<label class="line-length-control">Délka vodicí čáry <output data-line-length>${formatLineLength(value, step)}</output><input name="lineLength" type="range" min="${min.toFixed(digits)}" max="${max.toFixed(digits)}" step="${step.toFixed(digits)}" value="${value.toFixed(digits)}" /></label>`;
}
