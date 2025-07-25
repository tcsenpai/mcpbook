import { useEffect, useRef } from 'react'

interface TerminalProps {
  output: string[]
}

export default function Terminal({ output }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Auto-scroll to bottom when new output is added
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [output])

  return (
    <div 
      ref={terminalRef}
      className="terminal h-80 p-4 overflow-y-auto resize-y"
    >
      {output.length === 0 ? (
        <div className="text-terminal-text opacity-60">
          Terminal ready. Use the buttons above to execute commands...
        </div>
      ) : (
        <div className="terminal-output">
          {output.map((line, index) => {
            // SECURITY FIX: Remove HTML tags and render as safe text
            // Parse the terminal output and extract just the text content
            const cleanText = line
              .replace(/<span[^>]*>/g, '') // Remove opening span tags
              .replace(/<\/span>/g, '')    // Remove closing span tags
              .replace(/&lt;/g, '<')       // Decode HTML entities
              .replace(/&gt;/g, '>')
              .replace(/&amp;/g, '&');
            
            return (
              <div 
                key={index} 
                className="mb-1 text-terminal-text font-mono text-sm"
              >
                {cleanText}
              </div>
            );
          })}
        </div>
      )}
      
      {/* Cursor */}
      <div className="flex items-center mt-2">
        <span className="text-terminal-green mr-2">❯</span>
        <span className="w-2 h-4 bg-terminal-text animate-pulse"></span>
      </div>
    </div>
  )
}