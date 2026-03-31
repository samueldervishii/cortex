import { Ref } from 'react'

interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onFileUpload?: (file: File, message: string) => void
  disabled?: boolean
  placeholder?: string
  centered?: boolean
}

declare const ChatInput: React.ForwardRefExoticComponent<
  ChatInputProps & React.RefAttributes<{ focus: () => void }>
>
export default ChatInput
