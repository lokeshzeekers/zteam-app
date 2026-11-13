import { dayLabel } from '../utils/dates';

// Centered day pill inside the chat ("Today", "Yesterday", "Monday", "12 March 2026").
export default function DateSeparator({ time }) {
  return (
    <div className="date-separator" role="separator">
      <span>{dayLabel(time)}</span>
    </div>
  );
}
