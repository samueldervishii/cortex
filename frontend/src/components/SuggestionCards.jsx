import { useState, useEffect } from 'react'

const SUGGESTION_CATEGORIES = [
  {
    icon: '',
    title: 'Analyze a complex topic',
    prompts: [
      'Help me understand and analyze the key concepts of quantum computing',
      'Explain the main differences between machine learning and deep learning',
      'Break down the fundamentals of blockchain technology',
      'Analyze the pros and cons of microservices vs monolithic architecture',
    ],
  },
  {
    icon: '',
    title: 'Brainstorm ideas',
    prompts: [
      'Generate creative ideas for improving team collaboration in remote work',
      'Suggest innovative features for a mobile productivity app',
      'Brainstorm ways to make my website more engaging',
      'Come up with unique marketing campaign ideas for a tech startup',
    ],
  },
  {
    icon: '',
    title: 'Research and compare',
    prompts: [
      'Compare different approaches to implementing microservices architecture',
      'What are the differences between React, Vue, and Angular?',
      'Compare SQL vs NoSQL databases for a social media application',
      'Research the best practices for API design and authentication',
    ],
  },
  {
    icon: '',
    title: 'Write and refine',
    prompts: [
      'Help me draft a professional email for requesting feedback from my team',
      'Write a compelling README for my open-source project',
      'Create technical documentation for a REST API',
      'Draft a project proposal for implementing a new feature',
    ],
  },
  {
    icon: '',
    title: 'Debug and solve',
    prompts: [
      'Help me troubleshoot why my React component is re-rendering unnecessarily',
      'Debug why my API is returning 500 errors intermittently',
      'Find the issue causing memory leaks in my Node.js application',
      'Solve the problem of slow database queries in my application',
    ],
  },
  {
    icon: '',
    title: 'Plan and strategize',
    prompts: [
      'Create a step-by-step plan for learning a new programming language',
      'Design a roadmap for migrating from monolith to microservices',
      'Plan the architecture for a scalable e-commerce platform',
      'Outline a strategy for improving application performance',
    ],
  },
]

function SuggestionCards({ onSelectSuggestion, isVisible = true }) {
  const [expandedIndex, setExpandedIndex] = useState(null)
  const [isAnimatingOut, setIsAnimatingOut] = useState(false)

  useEffect(() => {
    if (!isVisible) {
      setIsAnimatingOut(true)
    } else {
      setIsAnimatingOut(false)
    }
  }, [isVisible])

  const handleCategoryClick = (index) => {
    setExpandedIndex(expandedIndex === index ? null : index)
  }

  const handlePromptClick = (prompt) => {
    setIsAnimatingOut(true)
    setTimeout(() => {
      onSelectSuggestion(prompt)
      setExpandedIndex(null)
    }, 300)
  }

  return (
    <div className={`suggestion-cards ${isAnimatingOut ? 'fade-out' : 'fade-in'}`}>
      <div className="suggestion-grid">
        {SUGGESTION_CATEGORIES.map((category, index) => (
          <div
            key={index}
            className="suggestion-card-wrapper"
            style={{ animationDelay: `${index * 0.08}s` }}
          >
            <button
              className={`suggestion-card ${expandedIndex === index ? 'expanded' : ''}`}
              onClick={() => handleCategoryClick(index)}
            >
              <span className="suggestion-card-icon">{category.icon}</span>
              <span className="suggestion-card-title">{category.title}</span>
              <span className="suggestion-card-arrow">{expandedIndex === index ? '▼' : '▶'}</span>
            </button>
            {expandedIndex === index && (
              <div className="suggestion-dropdown">
                {category.prompts.map((prompt, promptIndex) => (
                  <button
                    key={promptIndex}
                    className="suggestion-prompt"
                    onClick={() => handlePromptClick(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default SuggestionCards
