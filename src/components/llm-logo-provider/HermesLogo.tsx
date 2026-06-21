import hermesAvatar from './hermes-avatar.jpg';

type HermesLogoProps = {
  className?: string;
};

/**
 * Hermes Agent icon — the official Nous "Hermes" avatar (apps/desktop/public/nous-girl.jpg).
 * Sized by the caller's className (matching the other provider logos).
 */
export default function HermesLogo({ className = 'w-5 h-5' }: HermesLogoProps) {
  return (
    <img
      src={hermesAvatar}
      alt="Hermes"
      className={`${className} rounded-full object-cover`}
      draggable={false}
    />
  );
}
