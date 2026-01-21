import React, { useEffect, useState } from 'react';
import Joyride, { ACTIONS, EVENTS, STATUS } from 'react-joyride';

const ProductTour = ({ activeTour, onTourEnd }) => {
    const [run, setRun] = useState(false);
    const [steps, setSteps] = useState([]);

    useEffect(() => {
        if (activeTour) {
            let tourSteps = [];

            switch (activeTour) {
                case 'tour-a': // Background Tab
                    tourSteps = [
                        {
                            target: '#tour-rapid-btn',
                            content: "Click to transcribe a video from an open tab and process it 10× faster than real time.",
                            disableBeacon: true,
                            disableScrolling: true,
                        },
                        {
                            target: '#tour-url-input',
                            content: "Or paste a video link here.",
                        },

                    ];
                    break;
                case 'tour-b': // Live Tab
                    tourSteps = [
                        {
                            target: '#tour-source-toggle',
                            content: "Select audio source.",
                            disableBeacon: true,
                            disableScrolling: true,
                        },
                        {
                            target: '#tour-start-capture',
                            content: 'Click to begin. Your transcript will stream live in the box below.',
                        },
                        {
                            target: '#tour-assist-tab',
                            content: "Need real-time help? Switch to 'Assist' for AI-powered insights during the recording.",
                        },
                    ];
                    break;
                case 'tour-c': // File Tab
                    tourSteps = [
                        {
                            target: '#tour-upload-area',
                            content: 'Drag and drop or click to select and transcribe any audio or video file.',
                            disableBeacon: true,
                            disableScrolling: true,
                        },
                        {
                            target: '#tour-model-selector',
                            content: 'Select a model.',
                        },
                        {
                            target: '#tour-transcribe-btn',
                            content: 'Click here to upload and process your file.',
                        },

                    ];
                    break;
                default:
                    tourSteps = [];
            }

            setSteps(tourSteps);
            setRun(true);
        } else {
            setRun(false);
        }
    }, [activeTour]);

    const handleJoyrideCallback = (data) => {
        const { action, status } = data;
        const finishedStatuses = [STATUS.FINISHED, STATUS.SKIPPED];

        if (finishedStatuses.includes(status) || action === ACTIONS.CLOSE) {
            setRun(false);
            onTourEnd();
        }
    };

    return (
        <Joyride
            steps={steps}
            run={run}
            continuous
            showProgress
            showSkipButton
            callback={handleJoyrideCallback}
            locale={{
                last: 'Done',
            }}
            styles={{
                options: {
                    arrowColor: '#fff',
                    backgroundColor: '#fff',
                    overlayColor: 'rgba(0, 0, 0, 0.6)',
                    primaryColor: '#2D7FD3',
                    textColor: '#1E293B',
                    zIndex: 10000,
                },
                buttonNext: {
                    backgroundColor: '#2D7FD3',
                    fontSize: '14px',
                    padding: '8px 16px',
                    borderRadius: '4px',
                },
                buttonBack: {
                    color: '#64748B',
                    marginRight: 10,
                }
            }}
        />
    );
};

export default ProductTour;
