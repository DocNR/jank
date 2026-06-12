import * as SliderPrimitive from '@radix-ui/react-slider'
import * as React from 'react'

import { cn } from '@/lib/utils'

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & {
    hideThumb?: boolean
    enableHoverAnimation?: boolean
  }
>(({ className, hideThumb, enableHoverAnimation, ...props }, ref) => {
  const [isHovered, setIsHovered] = React.useState(false)

  return (
    <SliderPrimitive.Root
      ref={ref}
      className={cn('relative flex w-full touch-none items-center select-none', className)}
      {...props}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onTouchStart={() => setIsHovered(true)}
      onTouchEnd={() => setIsHovered(false)}
    >
      <SliderPrimitive.Track
        className={cn(
          'bg-primary/20 relative w-full grow cursor-pointer overflow-hidden rounded-full transition-all',
          isHovered && enableHoverAnimation ? 'h-3' : 'h-1.5'
        )}
      >
        <SliderPrimitive.Range className="bg-primary disabled:bg-primary/30 absolute h-full rounded-full" />
      </SliderPrimitive.Track>
      {!hideThumb && (
        <SliderPrimitive.Thumb
          className={cn(
            'border-primary bg-background focus-visible:ring-ring block h-4 w-4 cursor-pointer rounded-full border-2 transition-all duration-200 focus-visible:ring-2 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50'
          )}
        />
      )}
    </SliderPrimitive.Root>
  )
})
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
