function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('PNG export failed.'));
        return;
      }

      resolve(blob);
    }, 'image/png');
  });
}

async function downloadCanvas(canvas, filename) {
  const blob = await canvasToBlob(canvas);
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}

function buildFileStem(design) {
  return `kush-nail-designer-${design.summary.inscriptionNumber}-${design.style.value}`;
}

export {
  buildFileStem,
  downloadCanvas
};
