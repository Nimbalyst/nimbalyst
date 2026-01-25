import React from 'react';

export interface DiscordInvitationProps {
  isOpen: boolean;
  onClose: () => void;
  onDismiss: () => void;
}

const DiscordLogo = () => (
  <svg className="discord-logo w-12 h-auto" viewBox="0 0 71 55" fill="none" xmlns="http://www.w3.org/2000/svg">
    <g clipPath="url(#clip0)">
      <path d="M60.1045 4.8978C55.5792 2.8214 50.7265 1.2916 45.6527 0.41542C45.5603 0.39851 45.468 0.440769 45.4204 0.525289C44.7963 1.6353 44.105 3.0834 43.6209 4.2216C38.1637 3.4046 32.7345 3.4046 27.3892 4.2216C26.905 3.0581 26.1886 1.6353 25.5617 0.525289C25.5141 0.443589 25.4218 0.40133 25.3294 0.41542C20.2584 1.2888 15.4057 2.8186 10.8776 4.8978C10.8384 4.9147 10.8048 4.9429 10.7825 4.9795C1.57795 18.7309 -0.943561 32.1443 0.293408 45.3914C0.299005 45.4562 0.335386 45.5182 0.385761 45.5576C6.45866 50.0174 12.3413 52.7249 18.1147 54.5195C18.2071 54.5477 18.305 54.5139 18.3638 54.4378C19.7295 52.5728 20.9469 50.6063 21.9907 48.5383C22.0523 48.4172 21.9935 48.2735 21.8676 48.2256C19.9366 47.4931 18.0979 46.6 16.3292 45.5858C16.1893 45.5041 16.1781 45.304 16.3068 45.2082C16.679 44.9293 17.0513 44.6391 17.4067 44.3461C17.471 44.2926 17.5606 44.2813 17.6362 44.3151C29.2558 49.6202 41.8354 49.6202 53.3179 44.3151C53.3935 44.2785 53.4831 44.2898 53.5502 44.3433C53.9057 44.6363 54.2779 44.9293 54.6529 45.2082C54.7816 45.304 54.7732 45.5041 54.6333 45.5858C52.8646 46.6197 51.0259 47.4931 49.0921 48.2228C48.9662 48.2707 48.9102 48.4172 48.9718 48.5383C50.038 50.6034 51.2554 52.5699 52.5959 54.435C52.6519 54.5139 52.7526 54.5477 52.845 54.5195C58.6464 52.7249 64.529 50.0174 70.6019 45.5576C70.6551 45.5182 70.6887 45.459 70.6943 45.3942C72.1747 30.0791 68.2147 16.7757 60.1968 4.9823C60.1772 4.9429 60.1437 4.9147 60.1045 4.8978ZM23.7259 37.3253C20.2276 37.3253 17.3451 34.1136 17.3451 30.1693C17.3451 26.225 20.1717 23.0133 23.7259 23.0133C27.308 23.0133 30.1626 26.2532 30.1066 30.1693C30.1066 34.1136 27.28 37.3253 23.7259 37.3253ZM47.3178 37.3253C43.8196 37.3253 40.9371 34.1136 40.9371 30.1693C40.9371 26.225 43.7636 23.0133 47.3178 23.0133C50.9 23.0133 53.7545 26.2532 53.6986 30.1693C53.6986 34.1136 50.9 37.3253 47.3178 37.3253Z" fill="white"/>
    </g>
    <defs>
      <clipPath id="clip0">
        <rect width="71" height="55" fill="white"/>
      </clipPath>
    </defs>
  </svg>
);

export const DiscordInvitation: React.FC<DiscordInvitationProps> = ({
  isOpen,
  onClose,
  onDismiss
}) => {
  if (!isOpen) return null;

  const handleJoinDiscord = () => {
    window.electronAPI.invoke('open-external', 'https://discord.gg/ubZDt4esEn');
    onClose();
  };

  const handleRemindLater = () => {
    onClose();
  };

  const handleDontRemind = () => {
    window.electronAPI.send('dismiss-discord-invitation');
    onDismiss();
  };

  return (
    <div
      className="discord-invitation-overlay fixed inset-0 flex items-center justify-center z-[10000] bg-black/60 animate-[discord-fade-in_0.2s_ease-out]"
      onClick={handleRemindLater}
    >
      <div
        className="discord-invitation relative p-0 w-[420px] max-w-[90vw] rounded-2xl overflow-hidden border border-[var(--nim-border)] bg-[var(--nim-bg)] shadow-[0_8px_32px_rgba(0,0,0,0.4)] animate-[discord-slide-up_0.3s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="discord-invitation-close absolute top-4 right-4 w-8 h-8 p-0 flex items-center justify-center bg-transparent border-none text-[28px] leading-none cursor-pointer rounded-md z-[1] text-[var(--nim-text-muted)] transition-[color,transform] duration-200 hover:text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)] hover:scale-110"
          onClick={handleRemindLater}
          aria-label="Close"
        >
          ×
        </button>

        <div className="discord-invitation-content px-8 pt-12 pb-8 text-center">
          <div className="discord-invitation-icon mx-auto mb-6 w-20 h-20 rounded-[20px] flex items-center justify-center bg-gradient-to-br from-[#5865f2] to-[#7289da] shadow-[0_4px_16px_rgba(88,101,242,0.3)]">
            <DiscordLogo />
          </div>

          <h2 className="discord-invitation-title m-0 mb-3 text-2xl font-bold tracking-[-0.5px] text-[var(--nim-text)]">Join Our Discord Community</h2>

          <p className="discord-invitation-message mb-8 text-[15px] leading-[1.6] max-w-[340px] mx-auto text-[var(--nim-text-muted)]">
            Connect with other Nimbalyst users, get help, share feedback, and stay updated on new features.
          </p>

          <div className="discord-invitation-buttons flex justify-center mb-6">
            <button
              className="discord-invitation-button discord-invitation-button-primary px-8 py-3.5 rounded-lg border-none text-base font-semibold cursor-pointer whitespace-nowrap flex items-center gap-2.5 text-white bg-gradient-to-br from-[#5865f2] to-[#7289da] shadow-[0_4px_12px_rgba(88,101,242,0.4)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(88,101,242,0.5)] active:translate-y-0"
              onClick={handleJoinDiscord}
            >
              <svg className="discord-button-icon w-5 h-auto text-white" viewBox="0 0 71 55" fill="none" xmlns="http://www.w3.org/2000/svg">
                <g clipPath="url(#clip0)">
                  <path d="M60.1045 4.8978C55.5792 2.8214 50.7265 1.2916 45.6527 0.41542C45.5603 0.39851 45.468 0.440769 45.4204 0.525289C44.7963 1.6353 44.105 3.0834 43.6209 4.2216C38.1637 3.4046 32.7345 3.4046 27.3892 4.2216C26.905 3.0581 26.1886 1.6353 25.5617 0.525289C25.5141 0.443589 25.4218 0.40133 25.3294 0.41542C20.2584 1.2888 15.4057 2.8186 10.8776 4.8978C10.8384 4.9147 10.8048 4.9429 10.7825 4.9795C1.57795 18.7309 -0.943561 32.1443 0.293408 45.3914C0.299005 45.4562 0.335386 45.5182 0.385761 45.5576C6.45866 50.0174 12.3413 52.7249 18.1147 54.5195C18.2071 54.5477 18.305 54.5139 18.3638 54.4378C19.7295 52.5728 20.9469 50.6063 21.9907 48.5383C22.0523 48.4172 21.9935 48.2735 21.8676 48.2256C19.9366 47.4931 18.0979 46.6 16.3292 45.5858C16.1893 45.5041 16.1781 45.304 16.3068 45.2082C16.679 44.9293 17.0513 44.6391 17.4067 44.3461C17.471 44.2926 17.5606 44.2813 17.6362 44.3151C29.2558 49.6202 41.8354 49.6202 53.3179 44.3151C53.3935 44.2785 53.4831 44.2898 53.5502 44.3433C53.9057 44.6363 54.2779 44.9293 54.6529 45.2082C54.7816 45.304 54.7732 45.5041 54.6333 45.5858C52.8646 46.6197 51.0259 47.4931 49.0921 48.2228C48.9662 48.2707 48.9102 48.4172 48.9718 48.5383C50.038 50.6034 51.2554 52.5699 52.5959 54.435C52.6519 54.5139 52.7526 54.5477 52.845 54.5195C58.6464 52.7249 64.529 50.0174 70.6019 45.5576C70.6551 45.5182 70.6887 45.459 70.6943 45.3942C72.1747 30.0791 68.2147 16.7757 60.1968 4.9823C60.1772 4.9429 60.1437 4.9147 60.1045 4.8978ZM23.7259 37.3253C20.2276 37.3253 17.3451 34.1136 17.3451 30.1693C17.3451 26.225 20.1717 23.0133 23.7259 23.0133C27.308 23.0133 30.1626 26.2532 30.1066 30.1693C30.1066 34.1136 27.28 37.3253 23.7259 37.3253ZM47.3178 37.3253C43.8196 37.3253 40.9371 34.1136 40.9371 30.1693C40.9371 26.225 43.7636 23.0133 47.3178 23.0133C50.9 23.0133 53.7545 26.2532 53.6986 30.1693C53.6986 34.1136 50.9 37.3253 47.3178 37.3253Z" fill="currentColor"/>
                </g>
              </svg>
              Join Discord
            </button>
          </div>

          <div className="discord-invitation-footer pt-4 flex items-center justify-center gap-2 border-t border-[var(--nim-border)]">
            <button
              className="discord-invitation-link bg-transparent border-none text-[13px] cursor-pointer px-2 py-1 no-underline text-[var(--nim-text-muted)] transition-colors duration-200 hover:text-[var(--nim-text)] hover:underline"
              onClick={handleRemindLater}
            >
              Remind Me Later
            </button>
            <span className="discord-invitation-separator text-[13px] select-none text-[var(--nim-text-faint)]">•</span>
            <button
              className="discord-invitation-link bg-transparent border-none text-[13px] cursor-pointer px-2 py-1 no-underline text-[var(--nim-text-muted)] transition-colors duration-200 hover:text-[var(--nim-text)] hover:underline"
              onClick={handleDontRemind}
            >
              Don't Show Again
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
