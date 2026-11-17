import type { SelectHTMLAttributes } from 'react'
import { LuChevronDown } from 'react-icons/lu'
import './Select.css'

/** Native <select> with a custom chevron. Style the box itself from the parent as usual. */
export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="select">
      <select className={className ? `select-input ${className}` : 'select-input'} {...props}>
        {children}
      </select>
      <LuChevronDown className="select-icon" aria-hidden="true" />
    </div>
  )
}
