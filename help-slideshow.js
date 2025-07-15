// Slideshow functionality
let slideIndex = 1;

function changeSlide(n) {
  showSlide(slideIndex += n);
}

function currentSlide(n) {
  showSlide(slideIndex = n);
}

function showSlide(n) {
  let slides = document.getElementsByClassName('screenshot-slide');
  let dots = document.getElementsByClassName('dot');
  
  console.log('showSlide called with n=', n, 'slides.length=', slides.length);
  
  if (n > slides.length) { slideIndex = 1; }
  if (n < 1) { slideIndex = slides.length; }
  
  for (let i = 0; i < slides.length; i++) {
    slides[i].classList.remove('active');
  }
  
  for (let i = 0; i < dots.length; i++) {
    dots[i].classList.remove('active');
  }
  
  if (slides[slideIndex-1]) {
    slides[slideIndex-1].classList.add('active');
  }
  if (dots[slideIndex-1]) {
    dots[slideIndex-1].classList.add('active');
  }
}

// Screenshot modal functionality
function openImageModal(img) {
  const modal = document.getElementById('imageModal');
  const modalImg = document.getElementById('modalImage');
  modal.style.display = 'block';
  modalImg.src = img.src;
}

function closeImageModal() {
  document.getElementById('imageModal').style.display = 'none';
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  // Add click handlers to navigation buttons
  const prevBtn = document.querySelector('.slideshow-prev');
  const nextBtn = document.querySelector('.slideshow-next');
  
  if (prevBtn) {
    prevBtn.addEventListener('click', function() {
      changeSlide(-1);
    });
  }
  
  if (nextBtn) {
    nextBtn.addEventListener('click', function() {
      changeSlide(1);
    });
  }
  
  // Add click handlers to dots
  const dots = document.querySelectorAll('.dot');
  dots.forEach((dot, index) => {
    dot.addEventListener('click', function() {
      currentSlide(index + 1);
    });
  });
  
  // Add click handlers to slideshow images
  const slideImages = document.querySelectorAll('.screenshot-slide img');
  slideImages.forEach(img => {
    img.addEventListener('click', function() {
      openImageModal(this);
    });
  });
  
  // Add click handler to modal close button
  const closeBtn = document.querySelector('.close-modal');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeImageModal);
  }
  
  // Close modal when clicking outside the image
  window.addEventListener('click', function(event) {
    const modal = document.getElementById('imageModal');
    if (event.target == modal) {
      modal.style.display = 'none';
    }
  });
  
  // Combined keyboard handler for both modal and slideshow
  document.addEventListener('keydown', function(event) {
    const modal = document.getElementById('imageModal');
    
    if (event.key === 'Escape' && modal.style.display === 'block') {
      closeImageModal();
    } else if (event.key === 'ArrowLeft' && modal.style.display !== 'block') {
      changeSlide(-1);
    } else if (event.key === 'ArrowRight' && modal.style.display !== 'block') {
      changeSlide(1);
    }
  });
});