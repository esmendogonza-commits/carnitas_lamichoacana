document.addEventListener('DOMContentLoaded', () => {
      const menuBtn = document.getElementById('mobile-menu-btn');
      const menuIcon = document.getElementById('mobile-menu-icon');
      const mobileMenu = document.getElementById('mobile-menu');

      if (menuBtn && mobileMenu) {
        const closeMenu = () => {
          mobileMenu.classList.add('hidden');
          mobileMenu.classList.remove('flex');
          menuBtn.setAttribute('aria-expanded', 'false');
          menuIcon.textContent = 'menu';
        };
        menuBtn.addEventListener('click', () => {
          const isOpen = !mobileMenu.classList.contains('hidden');
          if (isOpen) {
            closeMenu();
          } else {
            mobileMenu.classList.remove('hidden');
            mobileMenu.classList.add('flex');
            menuBtn.setAttribute('aria-expanded', 'true');
            menuIcon.textContent = 'close';
          }
        });
        mobileMenu.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
      }

      const tabButtons = document.querySelectorAll('.menu-tab-btn');
      const menuCards = document.querySelectorAll('.menu-card');

      tabButtons.forEach(button => {
        button.addEventListener('click', () => {
          // Cambiar estado activo visual
          tabButtons.forEach(btn => {
            btn.classList.remove('active', 'bg-primary', 'text-on-primary');
            btn.classList.add('bg-surface-container', 'text-on-surface');
          });
          button.classList.add('active', 'bg-primary', 'text-on-primary');
          button.classList.remove('bg-surface-container', 'text-on-surface');

          const category = button.getAttribute('data-category');

          menuCards.forEach(card => {
            if (category === 'todos' || card.getAttribute('data-item') === category) {
              card.style.display = 'flex';
            } else {
              card.style.display = 'none';
            }
          });
        });
      });
    });
