import { render, screen, fireEvent } from '@testing-library/react';
import Header from '../Header';
import { AppProvider } from '../../context/AppContext';
import { vi } from 'vitest';

// Mock FontAwesome to avoid rendering issues in pure JS environment if needed,
// but usually it works fine.
// We'll mock the AppContext
const mockUpdateSetting = vi.fn();
const mockSettings = { theme: 'dark' };

const MockAppProvider = ({ children }) => (
    <AppProvider value={{ settings: mockSettings, updateSetting: mockUpdateSetting }}>
        {children}
    </AppProvider>
);

describe('Header Component', () => {
    it('renders the title', () => {
        render(
            <MockAppProvider>
                <Header searchQuery="" setSearchQuery={() => {}} />
            </MockAppProvider>
        );
        expect(screen.getByText('LocalSync')).toBeInTheDocument();
    });

    it('updates search query', () => {
        const setSearchQuery = vi.fn();
        render(
            <MockAppProvider>
                <Header searchQuery="" setSearchQuery={setSearchQuery} />
            </MockAppProvider>
        );
        
        const input = screen.getByPlaceholderText('Search tasks...');
        fireEvent.change(input, { target: { value: 'Milk' } });
        
        expect(setSearchQuery).toHaveBeenCalledWith('Milk');
    });
});
