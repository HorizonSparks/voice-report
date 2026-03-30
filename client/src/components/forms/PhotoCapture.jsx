import { useRef, useState } from 'react';

export default function PhotoCapture({ photos = [], onChange, disabled }) {
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);
  const [viewingIdx, setViewingIdx] = useState(null);

  const handleCapture = (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const maxW = 1200;
          const maxH = 1200;
          let w = img.width;
          let h = img.height;
          if (w > maxW) { h = h * maxW / w; w = maxW; }
          if (h > maxH) { w = w * maxH / h; h = maxH; }

          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          onChange([...photos, dataUrl]);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });

    e.target.value = '';
  };

  const removePhoto = (idx) => {
    const updated = photos.filter((_, i) => i !== idx);
    onChange(updated);
    if (viewingIdx === idx) setViewingIdx(null);
  };

  return (
    <div className="photo-capture">
      {/* Hidden file inputs */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleCapture}
        style={{ display: 'none' }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleCapture}
        style={{ display: 'none' }}
      />

      {/* The big box — like comments textarea but for photos */}
      <div className="photo-box">
        {photos.length === 0 ? (
          /* Empty state — invite to add photos */
          <div className="photo-box-empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className="photo-box-icon">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
            <div className="photo-box-text">Tap below to add photo evidence</div>
          </div>
        ) : (
          /* Photos grid inside the box */
          <div className="photo-grid">
            {photos.map((src, i) => (
              <div key={i} className="photo-thumb-wrapper">
                <img
                  src={src}
                  alt={`Photo ${i + 1}`}
                  className="photo-thumb"
                  onClick={() => setViewingIdx(viewingIdx === i ? null : i)}
                />
                {!disabled && (
                  <button
                    type="button"
                    className="photo-remove-btn"
                    onClick={() => removePhoto(i)}
                    title="Remove photo"
                  >
                    &times;
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Action buttons below the box */}
      {!disabled && (
        <div className="photo-btn-row">
          <button
            type="button"
            className="photo-camera-btn"
            onClick={() => cameraRef.current?.click()}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
            <span>Camera</span>
          </button>

          <button
            type="button"
            className="photo-gallery-btn"
            onClick={() => galleryRef.current?.click()}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            <span>Gallery</span>
          </button>
        </div>
      )}

      {/* Full-size viewer */}
      {viewingIdx !== null && photos[viewingIdx] && (
        <div className="photo-viewer" onClick={() => setViewingIdx(null)}>
          <img src={photos[viewingIdx]} alt="Full size" className="photo-full" />
          <div className="photo-viewer-hint">Tap to close</div>
        </div>
      )}
    </div>
  );
}
