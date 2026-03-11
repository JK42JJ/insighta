import { PointerSensor, KeyboardSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';

export function useDndSensors() {
  const pointer = useSensor(PointerSensor, {
    activationConstraint: { distance: 5 },
  });
  const keyboard = useSensor(KeyboardSensor);
  const touch = useSensor(TouchSensor, {
    activationConstraint: { delay: 200, tolerance: 5 },
  });

  return useSensors(pointer, keyboard, touch);
}
