import type {JSX} from 'react';
import {useId} from 'react';

type Props = Readonly<{
  checked: boolean;
  id?: string;
  onClick: () => void;
  text: string;
}>;

export default function Switch({
  checked,
  onClick,
  text,
  id: customId,
}: Props): JSX.Element {
  const id = useId();
  const switchId = customId || id;

  return (
    <div className="switch">
      <label htmlFor={switchId}>
        {text}
      </label>
      <input
        type="checkbox"
        id={switchId}
        checked={checked}
        onChange={() => onClick()}
      />
    </div>
  );
}