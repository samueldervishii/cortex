import { useState } from 'react'

function VotingVisualization({ peerReviews, responses, disagreementAnalysis }) {
  const [expanded, setExpanded] = useState(false)

  if (!peerReviews || peerReviews.length === 0 || !responses || responses.length === 0) {
    return null
  }

  const validResponses = responses.filter((r) => !r.error)
  if (validResponses.length < 2) return null

  // Build a matrix of rankings: reviewer -> response -> rank
  const rankMatrix = {}
  const responseNames = validResponses.map((r) => r.model_name)

  for (const review of peerReviews) {
    rankMatrix[review.reviewer_model] = {}
    for (const ranking of review.rankings) {
      if (ranking.response_num && ranking.rank) {
        const respName = responseNames[ranking.response_num - 1]
        if (respName) {
          rankMatrix[review.reviewer_model][respName] = ranking.rank
        }
      }
    }
  }

  // Calculate average rank for each response
  const avgRanks = {}
  for (const respName of responseNames) {
    const ranks = Object.values(rankMatrix)
      .map((r) => r[respName])
      .filter((r) => r)
    avgRanks[respName] =
      ranks.length > 0 ? (ranks.reduce((a, b) => a + b, 0) / ranks.length).toFixed(1) : '-'
  }

  // Sort responses by average rank (lower is better)
  const sortedResponses = [...responseNames].sort((a, b) => {
    const aRank = parseFloat(avgRanks[a]) || 99
    const bRank = parseFloat(avgRanks[b]) || 99
    return aRank - bRank
  })

  return (
    <div className="voting-visualization">
      <button className="voting-toggle" onClick={() => setExpanded(!expanded)}>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M3 3v18h18" />
          <path d="M18 17V9" />
          <path d="M13 17V5" />
          <path d="M8 17v-3" />
        </svg>
        Council Voting Results
        <span className={`voting-chevron ${expanded ? 'expanded' : ''}`}>&#9660;</span>
      </button>

      {expanded && (
        <div className="voting-content">
          <div className="voting-leaderboard">
            <h4>Rankings (1 = Best)</h4>
            {sortedResponses.map((respName, idx) => {
              const avgRank = avgRanks[respName]
              const analysis = disagreementAnalysis?.find((a) => a.model_name === respName)
              const hasDisagreement = analysis?.has_disagreement

              return (
                <div key={respName} className={`voting-row ${idx === 0 ? 'top-ranked' : ''}`}>
                  <span className="voting-position">#{idx + 1}</span>
                  <span className="voting-model">{respName}</span>
                  <div className="voting-bar-container">
                    <div
                      className="voting-bar"
                      style={{ width: `${100 - (parseFloat(avgRank) - 1) * 25}%` }}
                    />
                  </div>
                  <span className="voting-score">{avgRank}</span>
                  {hasDisagreement && (
                    <span className="voting-disputed" title="Reviewers disagreed on this response">
                      ⚠
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          <div className="voting-matrix">
            <h4>Detailed Votes</h4>
            <table>
              <thead>
                <tr>
                  <th>Reviewer</th>
                  {sortedResponses.map((name) => (
                    <th key={name} title={name}>
                      {name.split(' ')[0]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(rankMatrix).map(([reviewer, ranks]) => (
                  <tr key={reviewer}>
                    <td title={reviewer}>{reviewer.split(' ')[0]}</td>
                    {sortedResponses.map((respName) => (
                      <td key={respName} className={ranks[respName] === 1 ? 'rank-first' : ''}>
                        {ranks[respName] || '-'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export default VotingVisualization
